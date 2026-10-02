// Mundo de teste da ingestão: banco real em memória + pasta de base temporária + worker REAL (thread) carregado do .ts (sem build).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { abrirBanco, migrar } from "../../../src/nucleo/banco";
import { criarRepositorios } from "../../../src/nucleo/banco/repos";
import { criarFontes, criarIngestao, criarServicoCusto, type DepsIngestao, type ProcessoLeitor } from "../../../src/nucleo/custo";

export const WORKER_TS = resolve(__dirname, "worker-ts.cjs");
export const novoWorkerReal = (): ProcessoLeitor => new Worker(WORKER_TS, { workerData: { paraCustoLeitor: true } }) as unknown as ProcessoLeitor;

export function mundoIngestao(extra: Partial<DepsIngestao> = {}) {
  const base = mkdtempSync(join(tmpdir(), "custo-base-"));
  const banco = abrirBanco(":memory:");
  migrar(banco);
  const r = criarRepositorios(banco);
  const AGORA = new Date("2026-06-10T12:00:00.000Z");
  const s = criarServicoCusto({ banco, relogio: () => AGORA });
  s.iniciarPrecos();
  const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
  const conta = r.conta.criar({ provedor: "claude", rotulo: "c" });
  const mis = r.mission.criar({ workspace_id: ws.id, modo: "agentico", origem: "feature", titulo: "M", trabalho_id: "w1" });
  const pane = r.pane.criar({ workspace_id: ws.id, mission_id: mis.id, tipo: "cli", cli: "claude", conta_id: conta.id, papel: "executor" });
  const codexPane = r.pane.criar({ workspace_id: ws.id, mission_id: mis.id, tipo: "cli", cli: "codex", conta_id: conta.id, papel: "executor" });
  const ocPane = r.pane.criar({ workspace_id: ws.id, mission_id: mis.id, tipo: "cli", cli: "opencode", conta_id: conta.id, papel: "executor", cwd: "/w/app" });
  const bases = { absoluto: (b: "claude_config" | "codex_home" | "opencode_data") => (b === "claude_config" ? join(base, "claude") : b === "codex_home" ? join(base, "codex") : join(base, "opencode")) };
  const fontes = criarFontes({ servico: s, bases, localizarSessaoOpenCode: (caminho, p) => ing.localizarSessaoOpenCode(caminho, p) });
  const criados: ProcessoLeitor[] = [];
  const ing = criarIngestao({
    servico: s,
    fontes,
    criarWorker: () => {
      const w = novoWorkerReal();
      criados.push(w);
      return w;
    },
    lerTranscripts: () => true,
    emFoco: () => true,
    ...extra,
  });
  const escrever = (relativo: string, conteudo: string, base_: "claude" | "codex" = "claude"): string => {
    const abs = join(base, base_, ...relativo.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, conteudo);
    return abs;
  };
  return {
    base, banco, r, s, ws, conta, mis, pane, codexPane, ocPane, fontes, ing, criados, escrever,
    fonteClaude: (relativo = "projects/p/s1.jsonl") => s.registrarFonte({ cli: "claude", base: "claude_config", relativo, conta_id: conta.id, pane_id: pane.id, mission_id: mis.id, workspace_id: ws.id }),
    async fechar() {
      await ing.parar();
      for (const w of criados) await w.terminate();
      banco.fechar();
      rmSync(base, { recursive: true, force: true });
    },
  };
}
