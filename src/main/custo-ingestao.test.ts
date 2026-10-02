// Ligação da ingestão no main (T-10.06/07): evento do Pane → fonte localizada → leitura pelo worker; sem worker configurado nada acontece; ler_transcripts:false desliga.
import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { abrirBanco, migrar, type Banco } from "../nucleo/banco";
import { criarRepositorios } from "../nucleo/banco/repos";
import { linhaClaude } from "../../tests/fixtures/custo/transcripts";
import { novoWorkerReal } from "../../tests/fixtures/custo/mundo-ingestao";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { criarBarramento } from "./barramento";
import { ligarCusto } from "./custo";

const limpar: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const f of limpar.splice(0)) await f();
});
const ID = "3ebe51c8-83df-4fb4-b2a0-16dfa7cd5f6f";
const espera = async (cond: () => boolean, ms = 4000): Promise<void> => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 25));
};

function montar(comIngestao: boolean, cli: string = "claude") {
  const home = mkdtempSync(join(tmpdir(), "custo-home-"));
  const banco: Banco = abrirBanco(":memory:");
  migrar(banco);
  const r = criarRepositorios(banco);
  const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
  const mis = r.mission.criar({ workspace_id: ws.id, modo: "agentico", origem: "feature", titulo: "M", trabalho_id: "w1" });
  const pane = r.pane.criar({ workspace_id: ws.id, mission_id: mis.id, tipo: "cli", cli, papel: "executor" });
  r.pane.registrarSessao(pane.id, ID);
  mkdirSync(join(home, ".claude/projects/p"), { recursive: true });
  writeFileSync(join(home, ".claude/projects/p", `${ID}.jsonl`), Array.from({ length: 4 }, (_, i) => linhaClaude({ id: `m${i}`, ts: new Date(Date.UTC(2026, 5, 1, 0, 0, i)).toISOString() })).join("\n") + "\n");
  const barramento = criarBarramento();
  const l = ligarCusto({
    banco,
    workspace: (id) => ({ id, raiz: "/w" }),
    metodo: { garantir: async () => undefined, indices: async () => ({ trabalhos: [] }) as never, rastro: async () => ({ eventos: [] }) as never },
    barramento,
    emitirRenderer: () => undefined,
    ...(comIngestao ? { ingestao: { criarWorker: novoWorkerReal, emFoco: () => true, home, ambiente: {} } } : {}),
  });
  limpar.push(async () => {
    l.encerrar();
    banco.fechar();
    rmSync(home, { recursive: true, force: true });
  });
  return { banco, l, pane, barramento, r };
}
const registros = (b: Banco): number => b.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM uso_registro")?.n ?? 0;

describe("ligação da ingestão de transcripts", () => {
  it("pane.state_changed localiza o transcript pela conversa e o worker alimenta o custo do Pane", async () => {
    const m = montar(true);
    m.l.iniciar();
    m.barramento.emitir("pane.state_changed", { pane_id: m.pane.id, estado: "trabalhando" });
    await espera(() => m.l.ingestao() !== null && registros(m.banco) === 4);
    expect(registros(m.banco)).toBe(4);
    expect(m.l.resumo({ escopo: "pane", chave: m.pane.id }).registros).toBe(4);
    // fim do Pane: drena e marca encerrada
    m.barramento.emitir("pane.closed", { pane_id: m.pane.id, reason: "encerrado" });
    await espera(() => m.l.fontes().some((f) => f.estado === "encerrada"));
    expect(m.l.fontes().some((f) => f.estado === "encerrada")).toBe(true);
  });
  it("sem `ingestao` configurada nada é lido nem criado", async () => {
    const m = montar(false);
    m.l.iniciar();
    m.barramento.emitir("pane.state_changed", { pane_id: m.pane.id, estado: "trabalhando" });
    await new Promise((r) => setTimeout(r, 100));
    expect(m.l.ingestao()).toBeNull();
    expect(registros(m.banco)).toBe(0);
  });
  it("ler_transcripts:false não lê nada", async () => {
    const m = montar(true);
    const c = m.l.configLer();
    m.l.configGravar({ ...c, ler_transcripts: false });
    m.l.iniciar();
    m.barramento.emitir("pane.state_changed", { pane_id: m.pane.id, estado: "trabalhando" });
    await new Promise((r) => setTimeout(r, 200));
    expect(registros(m.banco)).toBe(0);
  });
  it("CLI sem leitor (gemini) vira sem_fonte visível, nunca 0", async () => {
    const m = montar(true, "gemini");
    m.l.iniciar();
    m.barramento.emitir("pane.state_changed", { pane_id: m.pane.id, estado: "trabalhando" });
    await espera(() => m.l.fontes().some((f) => f.estado === "sem_fonte"));
    expect(m.l.fontes().find((f) => f.cli === "gemini")?.estado).toBe("sem_fonte");
    expect(m.l.resumo({ escopo: "pane", chave: m.pane.id }).usd).toBeNull();
  });
});
