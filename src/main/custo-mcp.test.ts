// Porta MCP do board e do custo (Fase 10, T-10.20) sobre banco real: escopo = Missão do token, somente leitura, custo desconhecido nunca vira 0.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../nucleo/banco";
import { criarRepositorios } from "../nucleo/banco/repos";
import { NaoEncontradoErro } from "../nucleo/dominio";
import type { IndiceProjeto } from "../nucleo/metodo/tipos";
import type { ClaimsDeCusto } from "../nucleo/mcp/portas";
import { criarBarramento, type Agendador } from "./barramento";
import { ligarCusto } from "./custo";
import { criarPortaCustoMcp } from "./custo-mcp";

const abertos: Banco[] = [];
const pastas: string[] = [];
afterEach(() => {
  abertos.splice(0).forEach((b) => b.fechar());
  pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
const AGORA = new Date("2026-06-10T12:00:00.000Z");
const agendador: Agendador = { setTimeout: () => 0, clearTimeout: () => undefined };
const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, titulo: `T ${id}`, fase: "F1", status, depende_de: [], paralelizavel: false, suite: "nao_executada", concluida_em: null, objetivo: "obj", criterio_aceite: "crit", teste_integracao: null, teste_funcional: null, teste_regressao: null, arquivo: `docs/sprintx/${id}.md`, duracao_observada_ms: null, ...extra });
const indice = (tasks: ReturnType<typeof task>[]): IndiceProjeto => ({ trabalhos: [{ id: "w1", tipo: "feature", titulo: "Trabalho 1", veredito_qa: null, veredito_auditoria: null, violacoes: [], ultima_atividade: "2026-06-10T00:00:00.000Z", sprints: [{ id: "s1", fases: [{ id: "F1", tasks }] }] }] }) as unknown as IndiceProjeto;
const tk = (entrada: number, saida = 0) => ({ entrada, cache_escrita: 0, cache_leitura: 0, saida });

function montar() {
  const banco = abrirBanco(":memory:");
  abertos.push(banco);
  migrar(banco);
  const raiz = mkdtempSync(join(tmpdir(), "custo-mcp-"));
  pastas.push(raiz);
  const r = criarRepositorios(banco);
  const ws = r.workspace.criar({ nome: "w", raiz });
  const ws2 = r.workspace.criar({ nome: "w2", raiz: join(raiz, "x") });
  const mis = r.mission.criar({ workspace_id: ws.id, modo: "agentico", origem: "feature", titulo: "M1", trabalho_id: "w1" });
  const outra = r.mission.criar({ workspace_id: ws.id, modo: "agentico", origem: "feature", titulo: "M2", trabalho_id: "w2" });
  const livre = r.mission.criar({ workspace_id: ws.id, modo: "squad", origem: "livre", titulo: "M3" });
  const exec = r.pane.criar({ workspace_id: ws.id, mission_id: mis.id, tipo: "cli", cli: "claude", papel: "executor" });
  const exec2 = r.pane.criar({ workspace_id: ws.id, mission_id: outra.id, tipo: "cli", cli: "claude", papel: "executor" });
  const tasks = [task("T-01.01", "concluida"), task("T-01.02", "pendente"), task("T-01.03", "pendente", { depende_de: ["T-01.02"] })];
  const l = ligarCusto({
    banco,
    workspace: (id) => {
      if (id !== ws.id && id !== ws2.id) throw new NaoEncontradoErro("Workspace", id);
      return { id, raiz };
    },
    metodo: { garantir: async () => undefined, indices: async () => new Map([[raiz, indice(tasks)]]), rastro: async () => ({ eventos: [], proximo: 0 }) },
    barramento: criarBarramento(agendador),
    emitirRenderer: () => undefined,
    relogio: () => AGORA,
  });
  const porta = criarPortaCustoMcp({ banco, board: l.board, custo: l.servico, relogio: () => AGORA });
  const claims = (m: { id: string } | null = mis, workspace = ws.id): ClaimsDeCusto => ({ workspace_id: workspace, mission_id: m === null ? null : m.id, pane_id: "p", role: "piloto", mode: "agentico" });
  return { banco, r, ws, ws2, mis, outra, livre, exec, exec2, l, porta, claims };
}
async function nominal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "?";
  }
  throw new Error("não falhou");
}

describe("task_list / task_get (porta)", () => {
  it("lista só o trabalho da Missão do token, leve, com prontidão; pagina por cursor e filtra por coluna", async () => {
    const m = montar();
    const p1 = await m.porta.listarTasks(m.claims(), { trabalho_id: null, coluna: null, limite: 2, cursor: null });
    expect(p1.itens).toHaveLength(2);
    expect(p1.proximo).not.toBeNull();
    const p2 = await m.porta.listarTasks(m.claims(), { trabalho_id: null, coluna: null, limite: 2, cursor: p1.proximo });
    expect([...p1.itens, ...p2.itens].map((c) => c.task_id).sort()).toEqual(["T-01.01", "T-01.02", "T-01.03"]);
    expect(p2.proximo).toBeNull();
    const todo = await m.porta.listarTasks(m.claims(), { trabalho_id: "w1", coluna: "a_fazer", limite: 50, cursor: null });
    expect(todo.itens.map((c) => [c.task_id, c.pronta])).toEqual([["T-01.02", true]]);
    // sem uso observado: custo desconhecido, nunca 0
    expect(todo.itens[0]?.custo.usd).toBeNull();
  });
  it("outra Missão/outro workspace/Missão sem trabalho: nada vaza", async () => {
    const m = montar();
    expect(await nominal(m.porta.listarTasks(m.claims(), { trabalho_id: "w2", coluna: null, limite: 10, cursor: null }))).toBe("not_found");
    expect(await nominal(m.porta.listarTasks(m.claims(m.mis, m.ws2.id), { trabalho_id: null, coluna: null, limite: 10, cursor: null }))).toBe("not_found");
    expect(await nominal(m.porta.listarTasks(m.claims(null), { trabalho_id: null, coluna: null, limite: 10, cursor: null }))).toBe("not_found");
    expect((await m.porta.listarTasks(m.claims(m.livre), { trabalho_id: null, coluna: null, limite: 10, cursor: null })).itens).toEqual([]);
    expect(await nominal(m.porta.listarTasks(m.claims(), { trabalho_id: null, coluna: null, limite: 10, cursor: "xx" }))).toBe("invalid_argument");
  });
  it("task_get traz contrato, custo por modelo (modelo sem preço ⇒ usd null + incompleto) e not_found para task inexistente ou de outra Missão", async () => {
    const m = montar();
    const s = m.l.servico();
    const f = s.registrarFonte({ cli: "claude", base: "claude_config", relativo: "a.jsonl", pane_id: m.exec.id, mission_id: m.mis.id, workspace_id: m.ws.id });
    m.banco.executar("INSERT INTO janela_task (workspace_id, trabalho_id, task_id, origem, pane_id, cwd_rel, inicio, fim) VALUES (?,?,?,?,?,NULL,?,NULL)", [m.ws.id, "w1", "T-01.02", "banco", m.exec.id, "2026-06-10T09:00:00.000Z"]);
    s.ingerir(f.id, [{ chave: "a", ts: "2026-06-10T10:00:00.000Z", modelo: "modelo-sem-preco-xyz", tokens: tk(1000, 50) }]);
    const d = await m.porta.obterTask(m.claims(), { task_id: "T-01.02", trabalho_id: null });
    expect(d).toMatchObject({ task_id: "T-01.02", coluna: "a_fazer", contrato: { objetivo: "obj", criterio_aceite: "crit" } });
    expect(d.custo).toMatchObject({ usd: null, incompleto: true });
    expect(d.custo_por_modelo[0]).toMatchObject({ modelo: "modelo-sem-preco-xyz", usd: null, tokens_entrada: 1000, tokens_saida: 50 });
    expect(await nominal(m.porta.obterTask(m.claims(), { task_id: "T-09.99", trabalho_id: null }))).toBe("not_found");
    expect(await nominal(m.porta.obterTask(m.claims(m.outra), { task_id: "T-01.02", trabalho_id: "w1" }))).toBe("not_found");
  });
});

describe("cost_report (porta)", () => {
  it("só a Missão do token; sem preço ⇒ usd null; com preço parcial ⇒ soma do resto + incompleto", async () => {
    const m = montar();
    const s = m.l.servico();
    const f1 = s.registrarFonte({ cli: "claude", base: "claude_config", relativo: "a.jsonl", pane_id: m.exec.id, mission_id: m.mis.id, workspace_id: m.ws.id });
    const f2 = s.registrarFonte({ cli: "claude", base: "claude_config", relativo: "b.jsonl", pane_id: m.exec2.id, mission_id: m.outra.id, workspace_id: m.ws.id });
    s.ingerir(f1.id, [
      { chave: "a", ts: "2026-06-10T10:00:00.000Z", modelo: "claude-sonnet-4-5", tokens: tk(1_000_000, 0) },
      { chave: "b", ts: "2026-06-10T10:01:00.000Z", modelo: "modelo-sem-preco-xyz", tokens: tk(10, 5) },
    ]);
    s.ingerir(f2.id, [{ chave: "c", ts: "2026-06-10T10:02:00.000Z", modelo: "claude-sonnet-4-5", tokens: tk(5_000_000, 0) }]);
    const r = await m.porta.relatorio(m.claims(), { agrupar: "modelo", desde: null, ate: null });
    expect(r.total).toMatchObject({ incompleto: true, tokens_entrada: 1_000_010, tokens_saida: 5 });
    expect((r.total.usd ?? 0) > 0 && (r.total.usd ?? 0) < 20).toBe(true); // a outra Missão (5 M tokens) não entra
    expect(r.linhas.find((l) => l.chave === "modelo-sem-preco-xyz")).toMatchObject({ usd: null, incompleto: true });
    const vazio = await m.porta.relatorio(m.claims(m.livre), { agrupar: "dia", desde: null, ate: null });
    expect(vazio.total.usd).toBeNull();
    expect(vazio.linhas).toEqual([]);
    expect(await nominal(m.porta.relatorio(m.claims(null), { agrupar: "dia", desde: null, ate: null }))).toBe("not_found");
  });
});
