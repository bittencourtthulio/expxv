import { ArvoreSujaErro, GitCanceladoErro, GitErro, GitOperacaoProibidaErro, GitTimeoutErro } from "../../git/erros";
import { executorPadrao, type ExecutorVcs, type ResultadoExec } from "../executor";
import { ramoAtual, rodarGit, validarNomeRef, resolverRev, type OpcoesBase } from "./comum";
import { guardaAutomacao, OperacaoRecusadaErro, type OrigemOperacao } from "./guardas";
import { FORMATO_LOG, parseLog, type CommitLog } from "./log";
import { estadoOperacao, type EstadoOperacao } from "./merge";
import { ehRamoPadrao } from "./ramos";

// T-06.12 · Remotos. Credenciais são SEMPRE as do usuário (credential helper, ssh-agent, `gh auth`); o app nunca
// guarda, lê nem repassa senha/token, e remove credenciais embutidas em URLs antes de exibir. `GIT_TERMINAL_PROMPT=0`
// é imposto pelo executor. O único `push` do app mora aqui; `--force` não existe; `--force-with-lease` só por
// `forceWithLease` (manual, confirmação digitada, nunca na branch padrão, sempre com simulação).

const TIMEOUT_REDE_MS = 30_000;
export const INSTRUCAO_AUTENTICACAO =
  "Autenticação necessária. Configure o credential helper (git config --global credential.helper), o ssh-agent (ssh-add) ou rode `gh auth login`; o app nunca guarda nem pede senha ou token.";

// ---- erros nominais -----------------------------------------------------------------------------

export class RemotoErro extends GitErro {
  override name = "RemotoErro";
}
export class RemotoAutenticacaoErro extends RemotoErro {
  override name = "RemotoAutenticacaoErro";
  readonly instrucao = INSTRUCAO_AUTENTICACAO;
  constructor(stderr: string) {
    super(`Falha de autenticação no remoto. ${INSTRUCAO_AUTENTICACAO}`, [], 128, semCredenciais(stderr));
  }
}
export class RemotoSemRedeErro extends RemotoErro {
  override name = "RemotoSemRedeErro";
  constructor(detalhe: string, stderr = "") {
    super(`Sem conexão com o remoto (${semCredenciais(detalhe)}). Verifique a rede e tente de novo.`, [], 128, semCredenciais(stderr));
  }
}
export class RemotoInexistenteErro extends RemotoErro {
  override name = "RemotoInexistenteErro";
  constructor(nome: string, stderr = "") {
    super(`Remoto ou repositório remoto não encontrado: ${semCredenciais(nome)}`, [], 128, semCredenciais(stderr));
  }
}
export class PullDivergenteErro extends RemotoErro {
  override name = "PullDivergenteErro";
  readonly opcoes = ["Integrar por merge (modo: 'merge')", "Reaplicar seus commits por cima (modo: 'rebase')", "Cancelar e revisar o histórico antes"];
  constructor(stderr: string) {
    super("O histórico local e o remoto divergiram; o pull só aceita avanço simples (--ff-only). Escolha merge ou rebase explicitamente.", [], 128, semCredenciais(stderr));
  }
}
export type MotivoRejeicao = "nao-fast-forward" | "protegida" | "hook" | "lease" | "outro";
/** Push rejeitado: explica o porquê e devolve as opções SEGURAS. */
export class PushRejeitadoErro extends RemotoErro {
  override name = "PushRejeitadoErro";
  constructor(readonly motivo: MotivoRejeicao, readonly explicacao: string, readonly opcoes: string[], stderr: string) {
    super(`Push rejeitado: ${explicacao}`, [], 1, semCredenciais(stderr));
  }
}

/** Remove `usuario:senha@` / `token@` de qualquer URL com esquema dentro do texto. */
export function semCredenciais(texto: string): string {
  return String(texto).replace(/([a-z][a-z0-9+.-]*):\/\/([^/\s@]*)@/gi, (todo, esquema: string, cred: string) => (/^(ssh|git\+ssh|ssh\+git)$/i.test(esquema) && !cred.includes(":") ? todo : `${esquema}://`));
}

/** Traduz o stderr do git em erro nominal; devolve null quando não reconhece (o chamador decide). */
export function classificarErroRemoto(stderr: string, nome = "remoto"): RemotoErro | null {
  const s = stderr;
  if (/HTTP\/?\S* ?40[13]|returned error: 40[13]|Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied \(publickey|Host key verification failed|Invalid username or password|access denied/i.test(s)) return new RemotoAutenticacaoErro(s);
  if (/does not appear to be a git repository|Repository not found|returned error: 404|No such remote|not a git repository/i.test(s)) return new RemotoInexistenteErro(nome, s);
  if (/Could not resolve host|Failed to connect|Connection (refused|timed out|reset|closed)|Network is unreachable|Temporary failure in name resolution|Operation timed out|No route to host|unable to access|early EOF|RPC failed|SSL_|Could not read from remote repository/i.test(s)) return new RemotoSemRedeErro(s.trim().split("\n")[0] ?? "falha de conexão", s);
  return null;
}

// ---- execução (única porta de rede/push do app) -------------------------------------------------

export interface OpcoesRede extends OpcoesBase {
  timeoutMs?: number;
  prioridadeBaixa?: boolean;
  env?: Record<string, string>;
}

const SUBCOMANDOS_REDE = new Set(["fetch", "pull", "push", "submodule"]);
const FLAGS_REDE_PROIBIDAS = /^(--force|-f|--force-if-includes|--force-with-lease|--mirror|--delete|-d|--(upload-pack|receive-pack|exec)(=.*)?)$/;
const LEASE_COM_REF = /^--force-with-lease=refs\/heads\/[^:\s]+:[0-9a-f]{7,64}$/;

/** A porta de rede só fala `fetch`/`pull`/`push`/`submodule`; opção global só `-c protocol.(file|ext).allow=…`; sem força nem programa externo (T-06.40, A-01). */
function validarArgsRemoto(args: readonly string[]): void {
  const recusa = (): never => {
    throw new GitOperacaoProibidaErro(args);
  };
  let i = 0;
  while (args[i] === "-c") {
    if (!/^protocol\.(file|ext)\.allow=(always|user|never)$/.test(args[i + 1] ?? "")) recusa();
    i += 2;
  }
  const sub = args[i];
  if (sub === undefined || !SUBCOMANDOS_REDE.has(sub)) recusa();
  for (const a of args.slice(i + 1)) {
    if (a === "--") break;
    if (a.startsWith("--force-with-lease=")) {
      if (sub !== "push" || !LEASE_COM_REF.test(a)) recusa();
      continue;
    }
    if (FLAGS_REDE_PROIBIDAS.test(a)) recusa();
    if (sub !== "submodule" && (a.startsWith("+") || a.startsWith(":"))) recusa();
  }
}

export async function rodarRemoto(raiz: string, args: readonly string[], op: OpcoesRede, tipo: "rede" | "escrita" = "rede"): Promise<ResultadoExec> {
  if (args.some((a) => typeof a !== "string" || a.includes("\0"))) throw new GitErro("Argumento inválido.");
  validarArgsRemoto(args);
  const ex: ExecutorVcs = op.executor ?? executorPadrao;
  try {
    return await ex.executar(args, {
      cwd: raiz,
      tipo,
      timeoutMs: op.timeoutMs ?? TIMEOUT_REDE_MS,
      tolerar: Array.from({ length: 255 }, (_, i) => i + 1),
      // rede em fila própria: um fetch lento nunca segura commits (escritas) do mesmo repositório
      ...(tipo === "rede" ? { chaveFila: `${raiz}\0rede` } : {}),
      ...(op.executavel ? { executavel: op.executavel } : {}),
      ...(op.signal ? { signal: op.signal } : {}),
      ...(op.env ? { env: op.env } : {}),
      ...(op.prioridadeBaixa ? { prioridadeBaixa: true } : {}),
    });
  } catch (e) {
    if (e instanceof GitTimeoutErro) throw new RemotoSemRedeErro(`sem resposta em ${e.timeoutMs} ms`);
    throw e;
  }
}

function falhou(r: ResultadoExec, nome: string): never {
  throw classificarErroRemoto(r.stderr, nome) ?? new GitErro(`git falhou (${r.codigo}): ${semCredenciais(r.stderr.trim().split("\n")[0] ?? "")}`, [], r.codigo, semCredenciais(r.stderr));
}

// ---- listar -------------------------------------------------------------------------------------

export interface Remoto {
  nome: string;
  /** URL de busca SEM credenciais. */
  url: string;
  urlPush: string | null;
  /** A URL configurada embute usuário/senha/token (aviso para migrar ao credential helper). */
  credenciaisNaUrl: boolean;
}

export async function listarRemotos(raiz: string, op: OpcoesBase = {}): Promise<Remoto[]> {
  const r = await rodarGit(raiz, ["config", "-z", "--get-regexp", "^remote\\..*\\.(url|pushurl)$"], { ...op, tolerar: [1] });
  const mapa = new Map<string, Remoto>();
  for (const reg of r.stdout.split("\0")) {
    const nl = reg.indexOf("\n");
    if (nl < 0) continue;
    const chave = reg.slice(0, nl);
    const valor = reg.slice(nl + 1);
    const m = /^remote\.(.+)\.(url|pushurl)$/i.exec(chave);
    if (!m) continue;
    const nome = m[1] as string;
    const e = mapa.get(nome) ?? { nome, url: "", urlPush: null, credenciaisNaUrl: false };
    if ((m[2] as string).toLowerCase() === "url") e.url = semCredenciais(valor);
    else e.urlPush = semCredenciais(valor);
    if (semCredenciais(valor) !== valor) e.credenciaisNaUrl = true;
    mapa.set(nome, e);
  }
  return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

async function escolherRemoto(raiz: string, pedido: string | undefined, ramo: string | null, op: OpcoesBase): Promise<string> {
  const lista = await listarRemotos(raiz, op);
  if (pedido !== undefined) {
    if (pedido.startsWith("-") || !lista.some((x) => x.nome === pedido)) throw new RemotoInexistenteErro(pedido);
    return pedido;
  }
  if (ramo !== null) {
    const c = await rodarGit(raiz, ["config", "--get", `branch.${ramo}.remote`], { ...op, tolerar: [1] });
    const nome = c.stdout.trim();
    if (c.codigo === 0 && lista.some((x) => x.nome === nome)) return nome;
  }
  if (lista.some((x) => x.nome === "origin")) return "origin";
  if (lista.length === 1) return (lista[0] as Remoto).nome;
  throw new RemotoInexistenteErro(lista.length === 0 ? "(nenhum remoto configurado)" : "(vários remotos: informe qual)");
}

// ---- fetch --------------------------------------------------------------------------------------

export interface ResultadoFetch {
  remotos: string[];
  /** Referências atualizadas ou novas. */
  atualizacoes: number;
  duracaoMs: number;
}

export async function fetchRemoto(raiz: string, opcoes: OpcoesRede & { remoto?: string; todos?: boolean; podar?: boolean } = {}): Promise<ResultadoFetch> {
  const { remoto, todos, podar, ...op } = opcoes;
  const ini = performance.now();
  const lista = await listarRemotos(raiz, op);
  const alvo = todos === true ? [] : [await escolherRemoto(raiz, remoto, await ramoAtual(raiz, op), op)];
  if (todos === true && lista.length === 0) throw new RemotoInexistenteErro("(nenhum remoto configurado)");
  const r = await rodarRemoto(raiz, ["fetch", "--no-recurse-submodules", ...(podar === true ? ["--prune"] : []), ...(todos === true ? ["--all"] : alvo)], op);
  if (r.codigo !== 0) falhou(r, alvo[0] ?? "remoto");
  const atualizacoes = r.stderr.split("\n").filter((l) => /->/.test(l) || /\[new (branch|tag)\]/.test(l)).length;
  return { remotos: todos === true ? lista.map((x) => x.nome) : alvo, atualizacoes, duracaoMs: performance.now() - ini };
}

// Fetch em segundo plano (P-22): no máximo 1 por vez em todo o processo, prioridade baixa, pausável, só com a
// janela em foco (função injetada) e sempre assíncrono (o main nunca espera).
let fetchAtivo = false;

export type MotivoSemFetch = "sem-foco" | "pausado" | "ocupado";
export type ResultadoFetchFundo = { executado: false; motivo: MotivoSemFetch } | { executado: true; resultado: ResultadoFetch } | { executado: true; erro: GitErro };

export interface FetchSegundoPlano {
  tentar(raiz: string, remoto?: string): Promise<ResultadoFetchFundo>;
  /** Pausa: aborta o fetch em curso e recusa novos até `retomar`. */
  pausar(): void;
  retomar(): void;
  /** Repete `tentar` a cada `ms` (timer sem segurar o processo). Devolve a função que para. */
  iniciarPeriodico(raiz: string, ms: number): () => void;
  ativo(): boolean;
}

export function criarFetchSegundoPlano(cfg: { janelaEmFoco: () => boolean; executor?: ExecutorVcs; timeoutMs?: number }): FetchSegundoPlano {
  let pausado = false;
  let ac: AbortController | null = null;
  const tentar = async (raiz: string, remoto?: string): Promise<ResultadoFetchFundo> => {
    if (pausado) return { executado: false, motivo: "pausado" };
    if (!cfg.janelaEmFoco()) return { executado: false, motivo: "sem-foco" };
    if (fetchAtivo) return { executado: false, motivo: "ocupado" };
    fetchAtivo = true;
    ac = new AbortController();
    try {
      const resultado = await fetchRemoto(raiz, { ...(remoto ? { remoto } : {}), signal: ac.signal, prioridadeBaixa: true, ...(cfg.executor ? { executor: cfg.executor } : {}), ...(cfg.timeoutMs ? { timeoutMs: cfg.timeoutMs } : {}) });
      return { executado: true, resultado };
    } catch (e) {
      if (e instanceof GitCanceladoErro) return { executado: false, motivo: "pausado" };
      return { executado: true, erro: e instanceof GitErro ? e : new GitErro(String(e)) };
    } finally {
      ac = null;
      fetchAtivo = false;
    }
  };
  return {
    tentar,
    pausar: () => {
      pausado = true;
      ac?.abort();
    },
    retomar: () => {
      pausado = false;
    },
    iniciarPeriodico: (raiz, ms) => {
      const t = setInterval(() => void tentar(raiz), Math.max(1000, ms));
      t.unref();
      return () => clearInterval(t);
    },
    ativo: () => fetchAtivo,
  };
}

// ---- pull ---------------------------------------------------------------------------------------

export type ModoPull = "ff-only" | "merge" | "rebase" | "config";

/** `pull.rebase` do repositório (nunca escrito por nós): null quando não configurado. */
export async function preferenciaPull(raiz: string, op: OpcoesBase = {}): Promise<string | null> {
  const r = await rodarGit(raiz, ["config", "--get", "pull.rebase"], { ...op, tolerar: [1] });
  return r.codigo === 0 && r.stdout.trim() !== "" ? r.stdout.trim() : null;
}

export interface ResultadoPull {
  resultado: "ok" | "ja-atualizado" | "conflito" | "simulado";
  modoUsado: ModoPull;
  antes: string | null;
  depois: string | null;
  /** Em `simular`: commits do upstream que entrariam. */
  entrariam?: CommitLog[];
  estado?: EstadoOperacao;
}

export async function pullRemoto(raiz: string, opcoes: OpcoesRede & { modo?: ModoPull; remoto?: string; ramo?: string; origem: OrigemOperacao; simular?: boolean }): Promise<ResultadoPull> {
  const { modo, remoto, ramo, origem, simular, ...op } = opcoes;
  const atual = await guardaAutomacao(raiz, origem, "pull", op);
  const cfgRebase = await preferenciaPull(raiz, op);
  const usado: ModoPull = modo ?? (cfgRebase !== null ? "config" : "ff-only");
  const head = async (): Promise<string | null> => {
    const r = await rodarGit(raiz, ["rev-parse", "--verify", "--quiet", "HEAD"], { ...op, tolerar: [1, 128] });
    return r.codigo === 0 ? r.stdout.trim() : null;
  };
  const antes = await head();
  if (simular === true) {
    const l = await rodarGit(raiz, ["log", FORMATO_LOG, "HEAD..@{upstream}"], { ...op, tolerar: [128] });
    return { resultado: "simulado", modoUsado: usado, antes, depois: antes, entrariam: l.codigo === 0 ? parseLog(l.stdout) : [] };
  }
  const nomeRemoto = remoto === undefined ? undefined : await escolherRemoto(raiz, remoto, atual, op);
  let nomeRamo: string | undefined;
  if (ramo !== undefined) nomeRamo = await validarNomeRef(raiz, ramo, "heads", op);
  if ((nomeRemoto === undefined) !== (nomeRamo === undefined)) throw new GitErro("Informe remoto E ramo, ou nenhum dos dois (usa o upstream).");
  const flag = usado === "ff-only" ? ["--ff-only"] : usado === "merge" ? ["--no-rebase"] : usado === "rebase" ? ["--rebase"] : [];
  const args = ["pull", "--no-edit", "--no-recurse-submodules", ...flag, ...(nomeRemoto !== undefined && nomeRamo !== undefined ? [nomeRemoto, nomeRamo] : [])];
  // pull mexe na árvore de trabalho: entra na fila de ESCRITA do repositório (serializa com commits), com prazo maior que o fetch
  const r = await rodarRemoto(raiz, args, { ...op, timeoutMs: op.timeoutMs ?? 120_000, env: { GIT_EDITOR: "true", GIT_MERGE_AUTOEDIT: "no", ...(op.env ?? {}) } }, "escrita");
  if (r.codigo !== 0) {
    const estado = await estadoOperacao(raiz, op);
    if (estado.operacao !== null && estado.conflitos.length > 0) return { resultado: "conflito", modoUsado: usado, antes, depois: await head(), estado };
    if (/Not possible to fast-forward|divergent branches|Need to specify how to reconcile/i.test(r.stderr)) throw new PullDivergenteErro(r.stderr);
    if (/would be overwritten|local changes|uncommitted changes/i.test(r.stderr)) throw new ArvoreSujaErro(raiz);
    falhou(r, nomeRemoto ?? "remoto");
  }
  const depois = await head();
  return { resultado: antes === depois || /Already up to date/i.test(r.stdout) ? "ja-atualizado" : "ok", modoUsado: usado, antes, depois };
}

// ---- push ---------------------------------------------------------------------------------------

export interface ResultadoPush {
  remoto: string;
  ramo: string;
  /** `--set-upstream` foi usado (a branch não tinha upstream). */
  upstreamDefinido: boolean;
  /** Nada a enviar. */
  atualizado: boolean;
}

function rejeicao(stderr: string, stdout: string): PushRejeitadoErro | null {
  const t = `${stdout}\n${stderr}`;
  const seguras = ["Buscar e integrar o remoto (pull --ff-only, ou escolha merge/rebase) e enviar de novo", "Enviar para outra branch (nome novo) e abrir um pedido de integração"];
  if (/stale info/i.test(t)) return new PushRejeitadoErro("lease", "o remoto mudou desde que você o viu (o lease não bate).", ["Fazer fetch, revisar o que chegou e refazer a simulação"], stderr);
  if (/non-fast-forward|fetch first|\(rejected\)|\[rejected\]/i.test(t) && !/remote rejected/i.test(t)) {
    return new PushRejeitadoErro("nao-fast-forward", "o remoto tem commits que você não tem; enviar apagaria o trabalho dele.", [...seguras, "Se reescrever a história for intencional: sobrescrever com lease (ação manual, confirmação digitada, nunca na branch padrão)"], stderr);
  }
  if (/protected branch|GH006|not allowed to push|denied to|cannot force-push/i.test(t)) return new PushRejeitadoErro("protegida", "a branch é protegida no remoto.", ["Enviar para outra branch e abrir um pull request"], stderr);
  if (/pre-receive|update hook|hook declined|remote rejected/i.test(t)) return new PushRejeitadoErro("hook", "um hook do remoto recusou o envio.", ["Ler a mensagem do remoto, corrigir e enviar de novo"], stderr);
  return null;
}

export async function pushRemoto(raiz: string, opcoes: OpcoesRede & { remoto?: string; ramo?: string; origem: OrigemOperacao }): Promise<ResultadoPush> {
  const { remoto, ramo, origem, ...op } = opcoes;
  const atual = await guardaAutomacao(raiz, origem, "push", op);
  const nomeRamo = ramo === undefined ? atual : await validarNomeRef(raiz, ramo, "heads", op);
  if (nomeRamo === null) throw new OperacaoRecusadaErro("Não há branch para enviar (HEAD destacado).", "sem-ramo");
  if (origem === "automacao" && (await ehRamoPadrao(raiz, nomeRamo, op))) throw new OperacaoRecusadaErro(`Automação não envia para a branch padrão (${nomeRamo}).`, "automacao-ramo-padrao", [nomeRamo]);
  const nomeRemoto = await escolherRemoto(raiz, remoto, nomeRamo, op);
  const up = await rodarGit(raiz, ["config", "--get", `branch.${nomeRamo}.merge`], { ...op, tolerar: [1] });
  const semUpstream = up.codigo !== 0 || up.stdout.trim() === "";
  const args = ["push", "--porcelain", ...(semUpstream ? ["--set-upstream"] : []), nomeRemoto, `refs/heads/${nomeRamo}:refs/heads/${nomeRamo}`];
  const r = await rodarRemoto(raiz, args, op);
  if (r.codigo !== 0) throw rejeicao(r.stderr, r.stdout) ?? classificarErroRemoto(r.stderr, nomeRemoto) ?? new GitErro(`push falhou (${r.codigo}): ${semCredenciais(r.stderr.trim().split("\n")[0] ?? "")}`, [], r.codigo, semCredenciais(r.stderr));
  return { remoto: nomeRemoto, ramo: nomeRamo, upstreamDefinido: semUpstream, atualizado: !/Everything up-to-date|^=\t/m.test(`${r.stdout}\n${r.stderr}`) };
}

// ---- force-with-lease (manual) ---------------------------------------------------------------------

export interface ResultadoLease {
  simulado: boolean;
  remoto: string;
  ramo: string;
  refEsperada: string;
  /** Commits do remoto (na `refEsperada`) que NÃO estão na sua branch e serão sobrescritos. */
  sobrescreveria: CommitLog[];
  enviado: boolean;
}

/**
 * Única forma de push forçado. Exige: origem `usuario`; branch que NÃO seja a padrão; `refEsperada` (o hash do remoto que
 * você viu); e, para executar de verdade, `confirmacao` digitada IGUAL ao nome da branch. `simular: true` (ou a própria
 * execução) devolve os commits remotos que seriam sobrescritos. O git recusa se o remoto não está em `refEsperada`.
 */
export async function forceWithLease(raiz: string, opcoes: OpcoesRede & { remoto?: string; ramo: string; refEsperada: string; confirmacao?: string; origem: OrigemOperacao; simular?: boolean }): Promise<ResultadoLease> {
  const { remoto, ramo, refEsperada, confirmacao, origem, simular, ...op } = opcoes;
  if (origem !== "usuario") throw new OperacaoRecusadaErro("Push forçado é uma ação manual: automação não pode.", "origem-invalida");
  const nome = await validarNomeRef(raiz, ramo, "heads", op);
  if (await ehRamoPadrao(raiz, nome, op)) throw new OperacaoRecusadaErro(`Push forçado na branch padrão (${nome}) é proibido.`, "ramo-padrao", [nome]);
  if (typeof refEsperada !== "string" || !/^[0-9a-f]{40,64}$/.test(refEsperada)) throw new OperacaoRecusadaErro("Informe o hash exato do remoto que você viu (refEsperada).", "confirmacao-invalida");
  const nomeRemoto = await escolherRemoto(raiz, remoto, nome, op);
  const local = await resolverRev(raiz, `refs/heads/${nome}`, op);
  const esperado = await resolverRev(raiz, refEsperada, { ...op }).catch(() => {
    throw new GitErro("O commit esperado do remoto não existe localmente: faça fetch e refaça a simulação.");
  });
  const l = await rodarGit(raiz, ["log", FORMATO_LOG, esperado, "--not", local], op);
  const sobrescreveria = parseLog(l.stdout);
  if (simular === true) return { simulado: true, remoto: nomeRemoto, ramo: nome, refEsperada: esperado, sobrescreveria, enviado: false };
  if (confirmacao !== nome) throw new OperacaoRecusadaErro(`Digite exatamente o nome da branch (${nome}) para confirmar o push forçado.`, "confirmacao-invalida", [nome]);
  const r = await rodarRemoto(raiz, ["push", "--porcelain", `--force-with-lease=refs/heads/${nome}:${esperado}`, nomeRemoto, `refs/heads/${nome}:refs/heads/${nome}`], op);
  if (r.codigo !== 0) throw rejeicao(r.stderr, r.stdout) ?? classificarErroRemoto(r.stderr, nomeRemoto) ?? new GitErro(`push falhou (${r.codigo}): ${semCredenciais(r.stderr.trim().split("\n")[0] ?? "")}`, [], r.codigo, semCredenciais(r.stderr));
  return { simulado: false, remoto: nomeRemoto, ramo: nome, refEsperada: esperado, sobrescreveria, enviado: true };
}
