// Ponte com o memox do método (T-08.10, D-47). A memória do ADE CONVIVE com o memox: só LÊ (`memox.py estado`), só APONTA no brief
// (`/expx:memox-arquivo`) e converte eventos do método em UMA linha curta deduplicada. Nunca escreve em `.expx/` nem em `docs/`;
// a reindexação (P-25) é feita pelo próprio script do memox (determinístico, sem modelo e sem rede), chamado por um executor injetado.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { consultarMemox, MEMOX_SCRIPT, type ResultadoMemox } from "../metodo/memox";

export const memoxInstalado = (raiz: string, existe: (p: string) => boolean = existsSync): boolean => existe(join(raiz, MEMOX_SCRIPT));

export interface EstadoMemoxApp {
  instalado: boolean;
  texto: string | null;
  aviso: string | null;
}

/** `ausente` é estado normal (sem erro); falha vira aviso discreto. */
export async function estadoMemox(raiz: string, consultar: (raiz: string, c: { tipo: "estado" }) => Promise<ResultadoMemox> = consultarMemox): Promise<EstadoMemoxApp> {
  const r = await consultar(raiz, { tipo: "estado" });
  return { instalado: r.estado !== "ausente", texto: r.estado === "ok" ? r.texto : null, aviso: r.aviso };
}

export interface EventoMetodoMemoria {
  /** chave de dedupe: o mesmo (trabalho, task, tipo) nunca vira duas entradas. */
  chave: string;
  texto: string;
  importancia: 2 | 3;
  trabalho_id: string;
}

/** `method.changed` com `task_concluida|veredito_emitido` → linha curta de Missão; qualquer outro tipo é ignorado. */
export function eventoDoMetodo(payload: unknown): EventoMetodoMemoria | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const tipo = p.tipo;
  const trabalho = typeof p.trabalho_id === "string" ? p.trabalho_id.slice(0, 120) : null;
  if (trabalho === null || (tipo !== "task_concluida" && tipo !== "veredito_emitido")) return null;
  const task = typeof p.task === "string" ? p.task.slice(0, 60) : "";
  const veredito = typeof p.veredito === "string" ? p.veredito.slice(0, 60) : "";
  const texto = tipo === "task_concluida" ? `Método: task ${task || "?"} concluída (${trabalho})` : `Método: veredito${veredito ? ` ${veredito}` : ""} emitido (${trabalho})`;
  return { chave: `${trabalho}|${task}|${tipo}`, texto, importancia: tipo === "veredito_emitido" ? 3 : 2, trabalho_id: trabalho };
}

export interface ResultadoReindexar {
  ok: boolean;
  aviso: string | null;
}
export type ExecutorMemox = (script: string, args: string[], op: { cwd: string; timeoutMs: number }) => Promise<{ codigo: number | null }>;

const executorReal: ExecutorMemox = (script, args, op) =>
  new Promise((resolver) => {
    const env: NodeJS.ProcessEnv = { PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8", NO_COLOR: "1" };
    for (const k of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TMPDIR", "TEMP"]) if (process.env[k] !== undefined) env[k] = process.env[k];
    try {
      const f = execFile("python3", [script, ...args], { cwd: op.cwd, env, timeout: op.timeoutMs, windowsHide: true, maxBuffer: 256 * 1024 }, (erro) => {
        resolver({ codigo: erro ? (typeof (erro as { code?: unknown }).code === "number" ? ((erro as { code: number }).code) : 1) : 0 });
      });
      f.stdin?.end();
    } catch {
      resolver({ codigo: null });
    }
  });

/**
 * P-25: depois de cada Missão, roda o script do memox (`reindexar`) — ele mesmo grava em `.expx/memoria/`, o ADE não escreve nada.
 * Sem memox instalado é no-op silencioso. O botão manual continua sendo `/expx:memox-indexar` digitado no Pane (D-20).
 */
export async function reindexarMemox(raiz: string, op: { executor?: ExecutorMemox; subcomando?: string; timeoutMs?: number } = {}): Promise<ResultadoReindexar> {
  if (!memoxInstalado(raiz)) return { ok: true, aviso: null };
  const r = await (op.executor ?? executorReal)(MEMOX_SCRIPT, [op.subcomando ?? "reindexar"], { cwd: raiz, timeoutMs: op.timeoutMs ?? 60_000 });
  return r.codigo === 0 ? { ok: true, aviso: null } : { ok: false, aviso: "Não foi possível reindexar o memox desta vez." };
}
