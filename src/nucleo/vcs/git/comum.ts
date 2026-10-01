import { GitErro, GitOperacaoProibidaErro, NomeInvalidoErro } from "../../git/erros";
import { executorPadrao, type ExecutorVcs, type ResultadoExec, type TipoComando } from "../executor";

// Base comum das operações de ESCRITA do git (6B): sem shell, argumentos separados, validação de nomes
// (nada começando com `-` vira opção), nunca `push` nem `--force`. Leituras com GIT_OPTIONAL_LOCKS=0
// (feito pelo executor); escritas em série por repositório (fila do executor).

export interface OpcoesBase {
  executor?: ExecutorVcs;
  executavel?: string;
  signal?: AbortSignal;
}

export interface OpcoesGitCmd extends OpcoesBase {
  tipo?: TipoComando;
  stdin?: string | Buffer;
  tolerar?: readonly number[];
  env?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  aoStdout?: (pedaco: Buffer) => void;
  aoStderr?: (pedaco: Buffer) => void;
  acumular?: boolean;
}

const FLAGS_PROIBIDAS = new Set(["--force", "-f", "--force-with-lease", "--force-if-includes"]);

/** Roda `git` pelo executor. Recusa `push` e flags de força; nunca usa shell. */
export function rodarGit(raiz: string, args: readonly string[], op: OpcoesGitCmd = {}): Promise<ResultadoExec> {
  if (args.length === 0 || args.some((a) => typeof a !== "string" || a.includes("\0"))) throw new GitOperacaoProibidaErro(args);
  const sub = args.find((a) => !a.startsWith("-"));
  if (sub === "push" || args.some((a) => FLAGS_PROIBIDAS.has(a))) throw new GitOperacaoProibidaErro(args);
  const ex = op.executor ?? executorPadrao;
  return ex.executar(args, {
    cwd: raiz,
    tipo: op.tipo ?? "leitura",
    ...(op.executavel ? { executavel: op.executavel } : {}),
    ...(op.signal ? { signal: op.signal } : {}),
    ...(op.stdin !== undefined ? { stdin: op.stdin } : {}),
    ...(op.tolerar ? { tolerar: op.tolerar } : {}),
    ...(op.env ? { env: op.env } : {}),
    ...(op.timeoutMs ? { timeoutMs: op.timeoutMs } : {}),
    ...(op.maxBytes ? { maxBytes: op.maxBytes } : {}),
    ...(op.aoStdout ? { aoStdout: op.aoStdout } : {}),
    ...(op.aoStderr ? { aoStderr: op.aoStderr } : {}),
    ...(op.acumular ? { acumular: true } : {}),
  });
}

export const escrita = (raiz: string, args: readonly string[], op: OpcoesGitCmd = {}): Promise<ResultadoExec> => rodarGit(raiz, args, { ...op, tipo: op.tipo ?? "escrita" });

/** Caminhos literais (sem glob/magic) para qualquer comando com pathspec. */
export const LITERAL = { GIT_LITERAL_PATHSPECS: "1" } as const;

// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000- \u007f]/;

/** Nome de ref (branch/tag/remoto) rigoroso: sem `-` inicial, `..`, espaço, controle, aspas; depois `git check-ref-format`. */
export async function validarNomeRef(raiz: string, nome: string, tipo: "heads" | "tags" = "heads", op: OpcoesBase = {}): Promise<string> {
  if (typeof nome !== "string" || nome === "" || nome.length > 255) throw new NomeInvalidoErro(String(nome));
  if (nome.startsWith("-") || nome.includes("..") || CONTROLE.test(nome) || /["'`\\~^:?*[$;|&<>(){}]|@\{|^@$/.test(nome)) throw new NomeInvalidoErro(nome);
  const r = await rodarGit(raiz, ["check-ref-format", `refs/${tipo}/${nome}`], { ...op, tolerar: [1] });
  if (r.codigo !== 0) throw new NomeInvalidoErro(nome);
  return nome;
}

/** Revisão de entrada (base, destino…): sem `-` inicial, espaço, controle nem `..`; devolve o hash resolvido. */
export async function resolverRev(raiz: string, rev: string, op: OpcoesBase = {}): Promise<string> {
  if (typeof rev !== "string" || rev === "" || rev.length > 255 || rev.startsWith("-") || rev.includes("..") || CONTROLE.test(rev) || /["'`\\]/.test(rev)) throw new NomeInvalidoErro(String(rev));
  const r = await rodarGit(raiz, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { ...op, tolerar: [1, 128] });
  const h = r.stdout.trim();
  if (r.codigo !== 0 || h === "") throw new GitErro(`Referência não encontrada: ${rev}`);
  return h;
}

/** Caminho relativo à raiz, sem `..`, sem NUL, sem `-` inicial ambíguo (sempre usado depois de `--`). */
export function caminhoSeguro(caminho: string): string {
  const c = String(caminho).replace(/\\/g, "/");
  if (c === "" || c.includes("\0") || c.startsWith("/") || /^[a-zA-Z]:/.test(c) || c.split("/").some((p) => p === "..")) throw new NomeInvalidoErro(String(caminho));
  return c;
}

/** HEAD existe (repositório com ao menos um commit)? */
export async function temCommits(raiz: string, op: OpcoesBase = {}): Promise<boolean> {
  const r = await rodarGit(raiz, ["rev-parse", "--verify", "--quiet", "HEAD"], { ...op, tolerar: [1, 128] });
  return r.codigo === 0;
}

/** Branch atual (null em HEAD destacado), funciona sem commits. */
export async function ramoAtual(raiz: string, op: OpcoesBase = {}): Promise<string | null> {
  const r = await rodarGit(raiz, ["symbolic-ref", "--short", "-q", "HEAD"], { ...op, tolerar: [1, 128] });
  return r.codigo === 0 ? r.stdout.trim() || null : null;
}

/** Quebra a saída `-z` em campos não vazios. */
export const campos = (s: string): string[] => s.split("\0").filter((x) => x !== "");
