import { ambienteGit, executorPadrao, SAIDA_MAX_PADRAO, type TipoComando } from "../vcs/executor";
import { GitOperacaoProibidaErro } from "./erros";

// Fachada do MVP: a execução em si mora em `vcs/executor.ts` (fila, abort, árvore de processos, env limpo).
// A API pública e os erros nominais continuam os mesmos.

export const TIMEOUT_PADRAO_MS = 5000;
export const SAIDA_MAX_BYTES = SAIDA_MAX_PADRAO;

export interface OpcoesGit {
  cwd: string;
  /** Padrão 5000 ms. */
  timeoutMs?: number;
  /** Teto de bytes guardados de stdout (e de stderr). Padrão 1 MiB; o excedente é descartado. */
  maxBytes?: number;
  /** Códigos de saída não-zero que NÃO devem lançar (o chamador interpreta). */
  tolerar?: readonly number[];
  /** Executável do git (injeção em teste). Padrão `git`. */
  executavel?: string;
  /** Cancela o comando (mata o processo e a árvore). */
  signal?: AbortSignal;
  /** Padrão: leitura para subcomandos só de leitura conhecidos; escrita (serial por repo) para o resto. */
  tipo?: TipoComando;
}

export interface ResultadoGit {
  codigo: number;
  stdout: string;
  stderr: string;
  /** true se stdout ou stderr passou do teto e foi cortado. */
  truncado: boolean;
}

/** Ambiente limpo: sem GIT_DIR/GIT_INDEX_FILE etc. herdados; sem prompt; locale fixo. */
export function ambienteLimpo(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return ambienteGit(base, "leitura");
}

const FLAGS_FORCA = new Set(["--force", "-f", "--force-with-lease", "--force-if-includes"]);
const SUBCOMANDOS_LEITURA = new Set([
  "status", "diff", "log", "show", "rev-parse", "symbolic-ref", "show-ref", "check-ref-format", "ls-files", "ls-tree",
  "cat-file", "rev-list", "for-each-ref", "blame", "describe", "merge-base", "diff-tree", "diff-index", "name-rev",
]);

/** Barreira de segurança: nunca push, nunca força. Remoção destrutiva só por função explícita. */
function validar(args: readonly string[]): void {
  if (args.length === 0 || args.some((a) => typeof a !== "string" || a.includes("\0"))) throw new GitOperacaoProibidaErro(args);
  const sub = args.find((a) => !a.startsWith("-"));
  if (sub === "push") throw new GitOperacaoProibidaErro(args);
  if (args.some((a) => FLAGS_FORCA.has(a))) throw new GitOperacaoProibidaErro(args);
}

/**
 * Roda `git` em processo filho assíncrono (sem shell), com timeout e saída limitada. Nunca bloqueia
 * o event loop. Código ≠ 0 lança GitErro, salvo se listado em `tolerar`.
 */
export function executarGit(args: readonly string[], opcoes: OpcoesGit): Promise<ResultadoGit> {
  validar(args); // síncrono de propósito: operação proibida lança antes de qualquer processo
  const sub = args.find((a) => !a.startsWith("-")) ?? "";
  return executorPadrao.executar(args, {
    cwd: opcoes.cwd,
    timeoutMs: opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS,
    ...(opcoes.maxBytes === undefined ? {} : { maxBytes: opcoes.maxBytes }),
    ...(opcoes.tolerar === undefined ? {} : { tolerar: opcoes.tolerar }),
    ...(opcoes.executavel === undefined ? {} : { executavel: opcoes.executavel }),
    ...(opcoes.signal === undefined ? {} : { signal: opcoes.signal }),
    tipo: opcoes.tipo ?? (SUBCOMANDOS_LEITURA.has(sub) ? "leitura" : "escrita"),
  }).then((r) => ({ codigo: r.codigo, stdout: r.stdout, stderr: r.stderr, truncado: r.truncado }));
}
