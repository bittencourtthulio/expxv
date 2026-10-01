import { readFile, stat } from "node:fs/promises";
import { GitCanceladoErro, GitIndisponivelErro, GitTimeoutErro } from "../git/erros";
import { executorPadrao, type ExecutorVcs, type OpcoesExec, type ResultadoExec } from "../vcs/executor";
import { semCredenciais } from "../vcs/git/remotos";
import { ForgeAutenticacaoErro, ForgeBranchProtegidaErro, ForgeCliAusenteErro, ForgeComandoErro, ForgeEntradaInvalidaErro, ForgeNaoEncontradoErro, ForgePermissaoErro, ForgeRateLimitErro, ForgeRecusadoErro, ForgeRedeErro } from "./erros";
import type { OpcoesEscrita, ProvedorForge, RepoRef } from "./forge";

// Peças comuns: redação de segredos, JSON tolerante, validação de argumentos, guarda de escrita e execução de CLI.

// ---- redação ------------------------------------------------------------------------------------

const PADROES_TOKEN = [/\bgh[pousr]_[A-Za-z0-9_]{16,}/g, /\bgithub_pat_[A-Za-z0-9_]{16,}/g, /\bglpat-[A-Za-z0-9_-]{12,}/g, /\bglcbt-[A-Za-z0-9_-]{12,}/g, /\bATBB[A-Za-z0-9_=-]{12,}/g, /(authorization|private-token|x-access-token)\s*[:=]\s*\S+(\s+\S+)?/gi, /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, /\b(token|password|senha)\s*[:=]\s*\S+/gi];
/** Remove credenciais de URL e padrões de token de qualquer texto que vá a erro, log ou evento. */
export function semSegredos(texto: string): string {
  let t = semCredenciais(String(texto));
  for (const p of PADROES_TOKEN) t = t.replace(p, "[oculto]");
  return t;
}

// ---- JSON tolerante e truncamento ---------------------------------------------------------------

export function parseJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}
export const obj = (x: unknown): Record<string, unknown> => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
export const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
export const str = (x: unknown, padrao = ""): string => (typeof x === "string" ? x : typeof x === "number" || typeof x === "boolean" ? String(x) : padrao);
export const num = (x: unknown, padrao = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && /^-?\d+$/.test(x) ? Number(x) : padrao);
export const bool = (x: unknown, padrao = false): boolean => (typeof x === "boolean" ? x : padrao);

export const LIMITE_CORPO = 64 * 1024;
export const LIMITE_COMENTARIO = 16 * 1024;
export const LIMITE_ITENS = 500;
export const MARCA_TRUNCADO = "\n[… texto truncado]";

export function truncarTexto(texto: string, max: number): { texto: string; truncado: boolean } {
  return texto.length <= max ? { texto, truncado: false } : { texto: texto.slice(0, max) + MARCA_TRUNCADO, truncado: true };
}
export function limitarLista<T>(itens: T[], max = LIMITE_ITENS): { itens: T[]; truncado: boolean } {
  return itens.length <= max ? { itens, truncado: false } : { itens: itens.slice(0, max), truncado: true };
}

// ---- validação de argumentos --------------------------------------------------------------------

export function validarNumero(valor: unknown, campo = "número"): number {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor <= 0) throw new ForgeEntradaInvalidaErro(campo, "precisa ser inteiro positivo");
  return valor;
}
/** Texto livre (título, corpo curto, busca): sem NUL; tamanho limitado. Vai sempre em `--opcao=valor`, nunca solto. */
export function validarTexto(valor: unknown, campo: string, max = 1000, obrigatorio = true): string {
  if (typeof valor !== "string") throw new ForgeEntradaInvalidaErro(campo, "precisa ser texto");
  if (obrigatorio && valor.trim() === "") throw new ForgeEntradaInvalidaErro(campo, "vazio");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000]/.test(valor)) throw new ForgeEntradaInvalidaErro(campo, "caractere nulo");
  if (valor.length > max) throw new ForgeEntradaInvalidaErro(campo, `passa de ${max} caracteres`);
  return valor;
}
/** Nome de branch/ref: nunca começa com `-`, sem `..`, espaço, controle ou metacaracteres de ref. */
export function validarRamo(valor: unknown, campo = "branch"): string {
  const v = validarTexto(valor, campo, 250);
  // eslint-disable-next-line no-control-regex
  if (v.startsWith("-") || v.startsWith("/") || v.endsWith("/") || v.endsWith(".") || v.endsWith(".lock") || /\.\.|\/\/|@\{|[\s~^:?*[\\\u0000-\u001f\u007f]/.test(v)) throw new ForgeEntradaInvalidaErro(campo, "nome de branch inválido");
  return v;
}
export function validarLogin(valor: unknown, campo = "usuário"): string {
  const v = validarTexto(valor, campo, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._@/-]*$/.test(v)) throw new ForgeEntradaInvalidaErro(campo, "login inválido");
  return v;
}
export function validarLabel(valor: unknown, campo = "label"): string {
  const v = validarTexto(valor, campo, 100);
  if (/[,\n\r]/.test(v)) throw new ForgeEntradaInvalidaErro(campo, "sem vírgula nem quebra de linha");
  return v;
}
export function validarHost(valor: string): string {
  if (!/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(:\d{1,5})?$/.test(valor)) throw new ForgeEntradaInvalidaErro("host", "hostname inválido");
  return valor.toLowerCase();
}
export function validarRepo(ref: RepoRef): RepoRef {
  const caminho = ref.caminho.replace(/\.git$/, "");
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._ -]*){1,6}$/.test(caminho) || caminho.includes("..")) throw new ForgeEntradaInvalidaErro("repositório", "use owner/repo");
  return { host: validarHost(ref.host), caminho };
}
/** `--nome=valor`: o valor, mesmo começando com `-`, nunca vira opção. */
export const opcao = (nome: string, valor: string | number): string => `--${nome}=${String(valor)}`;

/** `gh api`/`glab api`: só caminhos de leitura/escrita conhecidos (lista de prefixos), sem `..`, esquema, host ou fragmento. */
const PREFIXOS_API_GH = [/^rate_limit$/, /^repos\/[\w.-]+\/[\w.-]+(\/(pulls|issues|actions\/runs|commits|check-runs|collaborators|branches)(\/[\w./-]*)?)?(\?[\w=&%.,:+-]*)?$/];
const PREFIXOS_API_GL = [/^projects\/[\w%.-]+(\/(merge_requests|issues|pipelines|jobs|repository\/commits|members|users)(\/[\w./-]*)?)?(\?[\w=&%.,:+-]*)?$/, /^users\?[\w=&%.,:+-]*$/, /^user$/];
export function validarCaminhoApi(caminho: string, provedor: "github" | "gitlab"): string {
  const lista = provedor === "github" ? PREFIXOS_API_GH : PREFIXOS_API_GL;
  if (caminho.includes("..") || caminho.startsWith("/") || /^[a-z]+:/i.test(caminho) || caminho.includes("#") || !lista.some((r) => r.test(caminho))) throw new ForgeEntradaInvalidaErro("caminho da API", "fora da lista permitida");
  return caminho;
}

// ---- guarda de escrita --------------------------------------------------------------------------

/** Escrita exige `origem: 'usuario'` ou aprovação explícita injetada; automação NUNCA mescla (D-36). */
export async function guardaEscrita(e: OpcoesEscrita | undefined, rotulo: string, nuncaAutomacao = false): Promise<void> {
  const origem = (e as { origem?: unknown } | undefined)?.origem;
  if (origem === "usuario") return;
  if (origem !== "automacao") throw new ForgeRecusadoErro("Origem da operação inválida: toda escrita no forge precisa declarar a origem.", "origem-invalida");
  if (nuncaAutomacao) throw new ForgeRecusadoErro(`Automação não faz ${rotulo}: só uma pessoa decide isso.`, "automacao-nao-mescla");
  const ok = e?.aprovacao ? await e.aprovacao() : false;
  if (ok !== true) throw new ForgeRecusadoErro(`A automação precisa de aprovação explícita para ${rotulo}.`, "sem-aprovacao");
}

// ---- classificação de erro de CLI/REST ----------------------------------------------------------

export function classificarErroForge(provedor: ProvedorForge, saida: string, acao: string, codigo: number | null = null): Error {
  const s = semSegredos(saida);
  const linha = s.trim().split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  if (/rate limit|HTTP 429|too many requests|secondary rate/i.test(s)) {
    const reset = /x-ratelimit-reset:\s*(\d{9,})/i.exec(s)?.[1];
    return new ForgeRateLimitErro(reset ? Number(reset) : null, linha);
  }
  if (/auth login|not logged in|gh auth|glab auth|HTTP 401|401 Unauthorized|bad credentials|requires authentication|could not authenticate|no (oauth )?token|authentication (required|failed)|invalid (token|credentials)/i.test(s)) return new ForgeAutenticacaoErro(provedor, linha);
  if (/protected branch|required status check|base branch policy|review is required|required approving|branch protection|not mergeable|merge (is )?blocked|policy prohibits|pipeline must succeed|approvals? required|TF401027|policy/i.test(s) && /merg|push|approv|check|polic/i.test(s)) return new ForgeBranchProtegidaErro(linha);
  if (/HTTP 403|403 Forbidden|resource not accessible|must have (admin|write|push)|insufficient (scope|permission)|permission denied|not allowed to|forbidden|TF401019|access denied/i.test(s)) return new ForgePermissaoErro(acao, linha, provedor);
  if (/HTTP 404|404 Not Found|could not resolve to a (repository|pullrequest|issue)|no pull requests? found|not found/i.test(s)) return new ForgeNaoEncontradoErro(acao, linha);
  if (/could not resolve host|connection (refused|reset|timed out)|network is unreachable|dial tcp|i\/o timeout|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|no route to host/i.test(s)) return new ForgeRedeErro(linha);
  return new ForgeComandoErro(`Falha ao ${acao}${codigo === null ? "" : ` (código ${codigo})`}${linha ? `: ${linha}` : "."}`, codigo, s.slice(0, 2000));
}

// ---- execução de CLI (gh/glab) ------------------------------------------------------------------

const TODOS_CODIGOS = Array.from({ length: 255 }, (_, i) => i + 1);
const CONFIG_GIT_SEGURA: Record<string, string> = {
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "core.hooksPath",
  GIT_CONFIG_VALUE_0: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_KEY_1: "core.fsmonitor",
  GIT_CONFIG_VALUE_1: "false",
};
/** Ambiente imposto a toda chamada de CLI de forge: sem prompt, sem cor, sem atualização, git do `gh` sem hooks. */
export const AMBIENTE_CLI: Record<string, string> = { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_SPINNER_DISABLED: "1", NO_COLOR: "1", CLICOLOR: "0", GH_PAGER: "cat", PAGER: "cat", GLAB_CHECK_UPDATE: "false", GLAB_SEND_TELEMETRY: "false", NO_PROMPT: "1", ...CONFIG_GIT_SEGURA };

export interface OpcoesCli {
  tipo?: "leitura" | "escrita" | "rede";
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  aoStdout?: (p: Buffer) => void;
  encerrarNoLimite?: boolean;
}
export interface ConfigCli {
  provedor: "github" | "gitlab";
  cwd: string;
  executavel?: string;
  executor?: ExecutorVcs;
  /** Variáveis extras (testes). Nunca token. */
  env?: Record<string, string>;
}

export class RunnerCli {
  readonly executavel: string;
  private readonly executor: ExecutorVcs;
  constructor(private readonly cfg: ConfigCli) {
    this.executavel = cfg.executavel ?? (cfg.provedor === "github" ? "gh" : "glab");
    this.executor = cfg.executor ?? executorPadrao;
  }
  get cwd(): string {
    return this.cfg.cwd;
  }
  /** Roda a CLI sem shell. Nunca lança por código de saída (o chamador decide); lança para ausência, timeout e cancelamento. */
  async rodar(args: readonly string[], op: OpcoesCli = {}): Promise<ResultadoExec> {
    const tipo = op.tipo ?? "leitura";
    const o: OpcoesExec = { cwd: this.cfg.cwd, executavel: this.executavel, tipo, timeoutMs: op.timeoutMs ?? (tipo === "leitura" ? 30_000 : 90_000), tolerar: TODOS_CODIGOS, env: { ...AMBIENTE_CLI, ...this.cfg.env }, chaveFila: this.cfg.cwd };
    if (op.stdin !== undefined) o.stdin = op.stdin;
    if (op.signal) o.signal = op.signal;
    if (op.maxBytes !== undefined) o.maxBytes = op.maxBytes;
    if (op.aoStdout) o.aoStdout = op.aoStdout;
    if (op.encerrarNoLimite) o.encerrarNoLimite = true;
    try {
      return await this.executor.executar(args, o);
    } catch (e) {
      if (e instanceof GitIndisponivelErro) throw new ForgeCliAusenteErro(this.cfg.provedor);
      if (e instanceof GitTimeoutErro) throw new ForgeRedeErro(`tempo limite de ${e.timeoutMs} ms em ${this.executavel}`);
      if (e instanceof GitCanceladoErro) throw e;
      throw e;
    }
  }
  /** Roda e devolve stdout; erro de saída vira erro nominal. */
  async ok(args: readonly string[], acao: string, op: OpcoesCli = {}): Promise<string> {
    const r = await this.rodar(args, op);
    if (r.codigo !== 0) throw classificarErroForge(this.cfg.provedor, r.stderr || r.stdout, acao, r.codigo);
    return r.stdout;
  }
  async json(args: readonly string[], acao: string, op: OpcoesCli = {}): Promise<unknown> {
    return parseJson(await this.ok(args, acao, op));
  }
}

// ---- corpo vindo de arquivo (PR.md) -------------------------------------------------------------

/** Lê o corpo do PR de um arquivo (limite 256 KiB). Arquivo ausente/ilegível devolve null (o chamador usa `corpo`). */
export async function lerCorpoArquivo(caminho: string | undefined): Promise<string | null> {
  if (!caminho) return null;
  try {
    const s = await stat(caminho);
    if (!s.isFile() || s.size > 256 * 1024) return null;
    return (await readFile(caminho, "utf8")).replace(/\0/g, "");
  } catch {
    return null;
  }
}

// ---- remoto → RepoRef ---------------------------------------------------------------------------

/** `https://h/o/r.git`, `git@h:o/r.git`, `ssh://git@h:22/o/r` → `{host, caminho}`. Credenciais embutidas são descartadas. */
export function parseRemoto(url: string): RepoRef | null {
  const t = semCredenciais(url.trim());
  let host = "";
  let caminho = "";
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(t);
  const esq = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@\s]*@)?([^/:\s]+)(?::\d+)?\/(.+)$/i.exec(t);
  if (esq) [, host, caminho] = esq as unknown as [string, string, string];
  else if (scp) [, host, caminho] = scp as unknown as [string, string, string];
  else return null;
  caminho = caminho.replace(/\/+$/, "").replace(/\.git$/, "");
  if (host.toLowerCase().endsWith("ssh.dev.azure.com") || /^vs-ssh\./.test(host)) {
    const m = /^v3\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(caminho);
    return m ? { host: "dev.azure.com", caminho: `${m[1]}/${m[2]}/${m[3]}` } : null;
  }
  if (host.toLowerCase() === "dev.azure.com" || host.toLowerCase().endsWith(".visualstudio.com")) {
    const m = /^([^/]+)\/([^/]+)\/_git\/([^/]+)$/.exec(caminho) ?? /^([^/]+)\/_git\/([^/]+)$/.exec(caminho);
    if (m && m.length === 4) return { host: "dev.azure.com", caminho: `${m[1]}/${m[2]}/${m[3]}` };
    return null;
  }
  if (!/^[^/]+\/[^/]+(\/[^/]+)*$/.test(caminho)) return null;
  try {
    return validarRepo({ host: host.toLowerCase(), caminho });
  } catch {
    return null;
  }
}
/** Provedor pelo hostname (GitHub Enterprise e GitLab self-hosted entram por `hostsExtras`). */
export function provedorPorHost(host: string, extras: Partial<Record<ProvedorForge, readonly string[]>> = {}): ProvedorForge | null {
  const h = host.toLowerCase();
  for (const [p, hosts] of Object.entries(extras) as Array<[ProvedorForge, readonly string[]]>) if (hosts.some((x) => x.toLowerCase() === h)) return p;
  if (h === "github.com" || h.endsWith(".ghe.com")) return "github";
  if (h === "gitlab.com") return "gitlab";
  if (h === "bitbucket.org") return "bitbucket";
  if (h === "dev.azure.com") return "azure";
  if (/^github\./.test(h)) return "github";
  if (/^gitlab\./.test(h)) return "gitlab";
  return null;
}
