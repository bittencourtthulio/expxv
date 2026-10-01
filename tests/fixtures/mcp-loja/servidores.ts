// Utilitário dos servidores MCP FALSOS (Fase 7B, T-07B.06): monta o alvo stdio de cada modo e sobe/derruba
// processos de teste sem deixar órfão. Nunca instala pacote, nunca usa rede.

import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessaoStdio, matarArvore, type AlvoStdio } from "../../../src/nucleo/loja-mcp/verificacao";

export const PASTA_FALSOS = typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url));

export const MODOS_FALSOS = ["ok", "lento", "vazio", "crash", "lixo", "exige-variavel", "eco-ambiente", "segredo-no-stderr"] as const;
export type ModoFalso = (typeof MODOS_FALSOS)[number];

export const caminhoFalso = (modo: ModoFalso): string => join(PASTA_FALSOS, `${modo}.mjs`);

/** Ambiente mínimo para rodar o Node de teste (nada herdado do processo atual). */
export function ambienteMinimo(extras: Record<string, string> = {}): Record<string, string> {
  return { PATH: process.env["PATH"] ?? "/usr/bin:/bin", ...extras };
}

/** Alvo stdio de um servidor falso. `env` substitui o ambiente por completo (padrão: só PATH). */
export function alvoFalso(modo: ModoFalso, env: Record<string, string> = ambienteMinimo()): AlvoStdio {
  return { executavel: process.execPath, args: [caminhoFalso(modo)], env };
}

const vivos = new Set<ChildProcess>();

export interface ServidorSubido { filho: ChildProcess; pid: number; derrubar: () => Promise<void> }

/** Sobe um servidor falso de longa vida (stdin aberto). Use `derrubarTodos()` no `afterEach`. */
export function subirFalso(modo: ModoFalso, env: Record<string, string> = ambienteMinimo()): ServidorSubido {
  const filho = spawn(process.execPath, [caminhoFalso(modo)], { env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32", shell: false, windowsHide: true });
  vivos.add(filho);
  filho.stdout!.resume();
  filho.stderr!.resume();
  filho.stdin!.on("error", () => undefined);
  const saiu = new Promise<void>((r) => filho.once("close", () => { vivos.delete(filho); r(); }));
  return {
    filho,
    pid: filho.pid ?? -1,
    derrubar: async () => { matarArvore(filho); await Promise.race([saiu, new Promise<void>((r) => setTimeout(r, 1000))]); },
  };
}

/** Abre uma sessão JSON-RPC com handshake pronto (para chamar `tools/call` nos testes). */
export async function abrirSessao(modo: ModoFalso, env?: Record<string, string>): Promise<SessaoStdio> {
  const sessao = new SessaoStdio(alvoFalso(modo, env));
  sessaoAbertas.add(sessao);
  return sessao;
}
const sessaoAbertas = new Set<SessaoStdio>();

/** Derruba tudo que este utilitário subiu. */
export async function derrubarTodos(): Promise<void> {
  await Promise.all([...sessaoAbertas].map((s) => s.encerrar()));
  sessaoAbertas.clear();
  for (const f of [...vivos]) matarArvore(f);
  const t0 = Date.now();
  while (vivos.size > 0 && Date.now() - t0 < 1500) await new Promise((r) => setTimeout(r, 20));
  vivos.clear();
}

/** O processo ainda existe? (sinal 0). */
export function pidVivo(pid: number | null): boolean {
  if (pid === null || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export const pidsVivosDoUtilitario = (): number[] => [...vivos].map((f) => f.pid ?? -1).filter((p) => pidVivo(p));
