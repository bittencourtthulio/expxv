import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitCanceladoErro, GitErro, GitIndisponivelErro, NomeInvalidoErro } from "../../git/erros";
import { executorPadrao, type ExecutorVcs, type ResultadoExec, type TipoComando } from "../executor";
import type { OrigemOperacao } from "../git/guardas";

// Base comum do SVN (6D): `svn` roda SEMPRE pelo executor da 6A (sem shell, argv separado, LC_ALL=C.UTF-8),
// sempre com `--non-interactive`, nunca com senha/`--trust-server-cert` em argv, e toda entrada do usuário vai
// DEPOIS de `--` (nunca vira opção). Mensagens de commit vão por arquivo temporário (`-F`), nunca por argv.

export const INSTRUCAO_INSTALAR_SVN = "Instale o Subversion: brew install subversion (macOS) ou o pacote subversion da sua distribuição.";
export const INSTRUCAO_AUTENTICAR = "Autentique-se uma vez num terminal (ex.: `svn info <URL do repositório>`) para o svn guardar a credencial no cache; o app nunca pede nem guarda senha.";

export type CodigoNominalSvn =
  | "svn_indisponivel"
  | "autenticacao_necessaria"
  | "sem_permissao"
  | "certificado_nao_confiavel"
  | "sem_rede"
  | "copia_bloqueada"
  | "conflito"
  | "desatualizado"
  | "svn_falhou";

export class SvnErro extends GitErro {
  override name = "SvnErro";
  constructor(mensagem: string, readonly nominal: CodigoNominalSvn, args: readonly string[] = [], codigo: number | null = null, stderr = "", readonly instrucao?: string) {
    super(mensagem, args, codigo, stderr);
  }
}
export class SvnIndisponivelErro extends SvnErro {
  override name = "SvnIndisponivelErro";
  constructor(detalhe = "svn não encontrado") {
    super(`Subversion indisponível: ${detalhe}. ${INSTRUCAO_INSTALAR_SVN}`, "svn_indisponivel", [], null, "", INSTRUCAO_INSTALAR_SVN);
  }
}
export class AutenticacaoNecessariaErro extends SvnErro {
  override name = "AutenticacaoNecessariaErro";
  constructor(args: readonly string[], stderr: string) {
    super(`Autenticação necessária no Subversion. ${INSTRUCAO_AUTENTICAR}`, "autenticacao_necessaria", args, 1, stderr, INSTRUCAO_AUTENTICAR);
  }
}

export type MotivoRecusaSvn =
  | "origem-invalida"
  | "confirmacao-servidor"
  | "automacao-tronco"
  | "externals-externos"
  | "url-invalida"
  | "arvore-suja"
  | "layout-nao-padrao"
  | "destino-existe"
  | "proibido";

/** O app recusou por regra de segurança (nunca chegou a rodar o svn). */
export class SvnRecusadoErro extends SvnErro {
  override name = "SvnRecusadoErro";
  constructor(mensagem: string, readonly motivo: MotivoRecusaSvn, readonly detalhe: string[] = []) {
    super(mensagem, "svn_falhou");
  }
}

/** Traduz a falha do executor em erro nominal (sem vazar nada além do que o svn já disse no stderr). */
export function traduzirErroSvn(e: unknown, args: readonly string[]): unknown {
  if (e instanceof GitIndisponivelErro) return new SvnIndisponivelErro(e.message);
  if (e instanceof SvnErro || e instanceof GitCanceladoErro || !(e instanceof GitErro) || e.stderr === "") return e;
  const s = e.stderr;
  const primeira = s.trim().split("\n").find((l) => l.startsWith("svn:")) ?? s.trim().split("\n")[0] ?? "";
  if (/E215004|No more credentials|Authentication (failed|required)|authentication required|E170001: Authentication/i.test(s)) return new AutenticacaoNecessariaErro(args, s);
  if (/E170001|Authorization failed|E175013|Access to '.*' forbidden/i.test(s)) return new SvnErro(`Sem permissão no repositório: ${primeira}`, "sem_permissao", args, e.codigo, s);
  if (/E230001|certificate verification failed|SSL/i.test(s)) return new SvnErro("Certificado do servidor não confiável. O app nunca aceita certificado sozinho; confie nele num terminal.", "certificado_nao_confiavel", args, e.codigo, s, INSTRUCAO_AUTENTICAR);
  if (/E170013|E670002|Unable to connect|Could not resolve|Connection (refused|timed out)|Network is unreachable/i.test(s)) return new SvnErro(`Sem acesso ao servidor Subversion: ${primeira}`, "sem_rede", args, e.codigo, s);
  if (/E155004|E155037|is locked|Run 'svn cleanup'/i.test(s)) return new SvnErro(`Cópia de trabalho bloqueada: rode a limpeza (cleanup). ${primeira}`, "copia_bloqueada", args, e.codigo, s);
  if (/E160028|out of date|E160024/i.test(s)) return new SvnErro(`Cópia desatualizada: atualize (update) antes de enviar. ${primeira}`, "desatualizado", args, e.codigo, s);
  if (/E155015|conflict/i.test(s)) return new SvnErro(`Conflito: ${primeira}`, "conflito", args, e.codigo, s);
  return new SvnErro(`svn ${args[0] ?? ""} falhou: ${primeira}`, "svn_falhou", args, e.codigo, s);
}

export interface OpcoesBaseSvn {
  executor?: ExecutorVcs;
  /** Caminho do binário (padrão `svn`). Testes injetam o `svn` falso. */
  executavel?: string;
  /** Variáveis extras (ex.: PATH em teste). */
  env?: Record<string, string>;
  signal?: AbortSignal;
  /** Aceita URLs `file://` (só para teste/uso local explícito). Padrão: só https e svn+ssh. */
  permitirFile?: boolean;
}

/** Só os campos de `OpcoesBaseSvn` (descarta o resto das opções de cada operação). */
export function soBase(op: OpcoesBaseSvn): OpcoesBaseSvn {
  return {
    ...(op.executor ? { executor: op.executor } : {}),
    ...(op.executavel ? { executavel: op.executavel } : {}),
    ...(op.env ? { env: op.env } : {}),
    ...(op.signal ? { signal: op.signal } : {}),
    ...(op.permitirFile ? { permitirFile: true } : {}),
  };
}

export interface OpcoesSvnCmd extends OpcoesBaseSvn {
  tipo?: TipoComando;
  tolerar?: readonly number[];
  timeoutMs?: number;
  maxBytes?: number;
  stdin?: string;
  encerrarNoLimite?: boolean;
  aoStdout?: (pedaco: Buffer) => void;
  acumular?: boolean;
  /** Credencial EXPLÍCITA do usuário: usuário em argv, senha só por stdin (`--password-from-stdin`). */
  autenticacao?: { usuario: string; senhaStdin?: string };
}

const FLAGS_PROIBIDAS = /^--(password|trust-server-cert|trust-server-cert-failures|force-interactive|diff-cmd|diff3-cmd|editor-cmd|merge-cmd|config-dir|config-option|username|password-from-stdin)(=|$)/;

/**
 * Roda `svn <sub> --non-interactive <flags> [auth] -- <posicionais>`. `flags` são literais internos (e valores
 * validados); `posicionais` (caminhos, URLs, nomes) vão depois de `--`.
 */
export async function rodarSvn(cwd: string, sub: string, flags: readonly string[], posicionais: readonly string[] = [], op: OpcoesSvnCmd = {}): Promise<ResultadoExec> {
  const todos = [sub, ...flags, ...posicionais];
  if (todos.some((a) => typeof a !== "string" || a.includes("\0"))) throw new SvnRecusadoErro("Argumento inválido para svn.", "proibido");
  if (flags.some((f) => FLAGS_PROIBIDAS.test(f))) throw new SvnRecusadoErro(`Opção proibida: ${flags.find((f) => FLAGS_PROIBIDAS.test(f))}`, "proibido");
  if (!/^[a-z-]+$/.test(sub)) throw new SvnRecusadoErro("Subcomando inválido.", "proibido");
  const auth: string[] = [];
  let stdin = op.stdin;
  if (op.autenticacao !== undefined) {
    nomeSimples(op.autenticacao.usuario, "usuário");
    auth.push("--username", op.autenticacao.usuario);
    if (op.autenticacao.senhaStdin !== undefined) {
      auth.push("--password-from-stdin");
      stdin = `${op.autenticacao.senhaStdin}\n`;
    }
  }
  const args = [sub, "--non-interactive", ...flags, ...auth, ...(posicionais.length > 0 ? ["--", ...posicionais] : [])];
  const ex = op.executor ?? executorPadrao;
  try {
    return await ex.executar(args, {
      cwd,
      tipo: op.tipo === "escrita" || op.tipo === "rede" ? op.tipo : "leitura",
      executavel: op.executavel ?? "svn",
      ...(op.signal ? { signal: op.signal } : {}),
      ...(op.tolerar ? { tolerar: op.tolerar } : {}),
      ...(op.timeoutMs ? { timeoutMs: op.timeoutMs } : {}),
      ...(op.maxBytes ? { maxBytes: op.maxBytes } : {}),
      ...(op.env ? { env: op.env } : {}),
      ...(stdin !== undefined ? { stdin } : {}),
      ...(op.encerrarNoLimite ? { encerrarNoLimite: true } : {}),
      ...(op.aoStdout ? { aoStdout: op.aoStdout } : {}),
      ...(op.acumular ? { acumular: true } : {}),
    });
  } catch (e) {
    throw traduzirErroSvn(e, args);
  }
}

/** Escrita no WC (fila serial por cópia de trabalho). */
export const rodarSvnEscrita = (cwd: string, sub: string, flags: readonly string[], pos: readonly string[] = [], op: OpcoesSvnCmd = {}): Promise<ResultadoExec> =>
  rodarSvn(cwd, sub, flags, pos, { ...op, tipo: op.tipo ?? "escrita" });
/** Fala com o servidor (fila serial, timeout maior). */
export const rodarSvnRede = (cwd: string, sub: string, flags: readonly string[], pos: readonly string[] = [], op: OpcoesSvnCmd = {}): Promise<ResultadoExec> =>
  rodarSvn(cwd, sub, flags, pos, { ...op, tipo: op.tipo ?? "rede" });

// ---- validações ----------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/;

/** Nome simples (usuário, slug, changelist, propriedade): nada de `-` inicial, espaço, controle, `..`. */
export function nomeSimples(nome: string, rotulo = "nome"): string {
  if (typeof nome !== "string" || nome === "" || nome.length > 200 || nome.startsWith("-") || CONTROLE.test(nome) || /[\s"'`\\$;|&<>(){}*?[\]!@^]/.test(nome) || nome.includes("..")) throw new NomeInvalidoErro(`${rotulo}: ${String(nome)}`);
  return nome;
}

/** Caminho relativo dentro da cópia de trabalho (usado sempre depois de `--`). `@` ganha o `@` final (peg literal). */
export function caminhoWc(caminho: string): string {
  const c = String(caminho).replace(/\\/g, "/");
  if (c === "" || CONTROLE.test(c) || c.startsWith("/") || /^[a-zA-Z]:/.test(c) || c.split("/").some((p) => p === "..")) throw new NomeInvalidoErro(String(caminho));
  return c.includes("@") ? `${c}@` : c;
}

/** Caminho dentro do repositório (`trunk`, `branches/x`): relativo, sem `..`, sem `-` inicial. */
export function caminhoRepo(caminho: string): string {
  const c = String(caminho).replace(/^\/+|\/+$/g, "");
  if (c === "" || c.length > 500 || c.startsWith("-") || CONTROLE.test(c) || /[\s"'`\\$;|&<>(){}*?[\]!@^%#]/.test(c) || c.split("/").some((p) => p === ".." || p === "." || p === "" || p.startsWith("-"))) throw new NomeInvalidoErro(String(caminho));
  return c;
}

/** URL aceita: https, svn+ssh e (só por opção explícita) file; sem credencial embutida, sem `-` inicial. */
export function validarUrl(url: string, permitirFile = false): string {
  const recusa = (): never => {
    throw new SvnRecusadoErro(`URL não permitida: ${String(url).replace(/\/\/[^/@]*@/, "//***@")}`, "url-invalida");
  };
  if (typeof url !== "string" || url === "" || url.length > 2000 || url.startsWith("-") || CONTROLE.test(url) || /\s/.test(url)) return recusa();
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return recusa();
  }
  const okProto = u.protocol === "https:" || u.protocol === "svn+ssh:" || (permitirFile && u.protocol === "file:");
  if (!okProto || u.password !== "") return recusa();
  return url;
}

export function revisaoSvn(r: number | "HEAD" | string): string {
  if (r === "HEAD" || r === "BASE" || r === "COMMITTED" || r === "PREV") return r;
  const n = typeof r === "number" ? r : /^\d+$/.test(String(r)) ? Number(r) : NaN;
  if (!Number.isInteger(n) || n < 0) throw new NomeInvalidoErro(`revisão: ${String(r)}`);
  return String(n);
}

// ---- guardas -------------------------------------------------------------------------------------

export interface ConfirmacaoServidor {
  origem: OrigemOperacao;
  /** Precisa ser exatamente `true`: grava no servidor. */
  confirmadoServidor?: boolean;
}

/** Operação que GRAVA NO SERVIDOR: confirmação explícita e origem `usuario`. */
export function exigirConfirmacaoServidor(acao: string, op: ConfirmacaoServidor): void {
  if (op.origem !== "usuario") throw new SvnRecusadoErro(`${acao} grava no servidor e só pode partir do usuário.`, "origem-invalida");
  if (op.confirmadoServidor !== true) throw new SvnRecusadoErro(`${acao} grava no servidor: confirme explicitamente (confirmadoServidor: true).`, "confirmacao-servidor");
}

/** Mensagem em arquivo temporário UTF-8 (nunca em argv). `limpar` sempre remove a pasta. */
export async function mensagemEmArquivo(mensagem: string): Promise<{ arquivo: string; limpar: () => Promise<void> }> {
  const pasta = await mkdtemp(join(tmpdir(), "svn-msg-"));
  const arquivo = join(pasta, "mensagem.txt");
  await writeFile(arquivo, mensagem, { encoding: "utf8", mode: 0o600 });
  return { arquivo, limpar: () => rm(pasta, { recursive: true, force: true }) };
}
