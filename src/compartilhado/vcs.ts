// Contrato de IPC do versionamento (Fase 6E, T-06.31..T-06.37). Compartilhado por main, preload e renderer.
// ADITIVO a `ipc.ts`: família `vcs:*` com UM canal por assunto e a operação em `op` (união discriminada). Assim o preload
// tem 14 canais (não 90) e cada operação continua com validador estrito (campo extra ou ausente é erro; `null` explícito).
// O renderer NUNCA envia caminho absoluto, cwd nem executável: só `workspace_id` (+ `mission_id` para a árvore da Missão) e
// caminhos RELATIVOS à raiz (não confiáveis: o main revalida; AUD-23). Nada de rede acontece sem uma ação explícita do usuário.

import type { Capabilities, Commit, Diff, StatusRepo, TipoVcs } from "../nucleo/vcs/tipos";
import type {
  ArquivoConflito,
  CommitLog,
  ComparacaoBase,
  ConflitoSvn,
  DetalheCommit,
  EntradaReflog,
  EscolhaResolver,
  EstadoAutenticacaoSvn,
  EstadoOperacao,
  EstrategiaTroca,
  InfoConflito,
  LinhaBlame,
  LinhaBlameSvn,
  ModoPull,
  Operacao,
  OpcaoArquivo,
  PaginaLog,
  PaginaLogSvn,
  PassoRebase,
  RamoDetalhe,
  Remoto,
  Resolucao,
  ResultadoAplicar,
  ResultadoApagarRamo,
  ResultadoCommit,
  ResultadoCommitSvn,
  ResultadoDescartar,
  ResultadoDesfazer,
  ResultadoDesfazerOperacao,
  ResultadoFetch,
  ResultadoLease,
  ResultadoMergeSvn,
  ResultadoOperacao,
  ResultadoPull,
  ResultadoPush,
  ResultadoTrocar,
  ResultadoUpdate,
  Stash,
  TagInfo,
  WorktreeEstado,
} from "./vcs-tipos";
import type { CheckForge, EstadoForge, IssueResumo, PrDetalhe, PrResumo, ProvedorForge } from "../nucleo/forge/forge";

export type { Capabilities, Diff, StatusRepo, TipoVcs, Commit, CommitLog, RamoDetalhe, Stash, TagInfo, WorktreeEstado, EstadoOperacao, Operacao, Resolucao, PassoRebase };

// ---- alvo, resumo e estado -------------------------------------------------------------------

/** Qual árvore: a do workspace (`mission_id` null) ou a da Missão (worktree no git, cópia de trabalho irmã no SVN). */
export interface AlvoVcs {
  workspace_id: string;
  mission_id: string | null;
}

/** Leve (rodapé, aba, seletor, card da Missão): nunca traz a lista de arquivos. */
export interface ResumoVcs {
  tipo: TipoVcs;
  /** null em HEAD destacado ou fora de repositório. */
  branch: string | null;
  /** Hash curto de HEAD. */
  oid: string | null;
  sujo: boolean;
  ahead: number;
  behind: number;
  staged: number;
  nao_staged: number;
  nao_rastreados: number;
  conflitos: number;
  operacao: Operacao | null;
  /** Primeiro cálculo em curso (a UI mostra esqueleto). */
  calculando: boolean;
  degradado: boolean;
}

export interface EstadoVcs {
  tipo: TipoVcs;
  /** Relativo à raiz do workspace: `.` ou `../repo--slug` (Missão). Nunca absoluto (regra 12). */
  local: string;
  capabilities: Capabilities;
  status: StatusRepo;
  resumo: ResumoVcs;
  /** Git: rebase/merge/cherry-pick/revert em curso. */
  operacao: EstadoOperacao | null;
  ramo_padrao: string | null;
  /** O branch atual é o padrão: a automação não comita aqui e ações destrutivas pedem confirmação digitada. */
  ramo_protegido: boolean;
  /** SVN: o binário `svn` existe? (`false` vira a instrução `brew install subversion`). */
  svn_binario: boolean | null;
  /** Texto para estado vazio/erro (sem repositório, svn ausente...). */
  mensagem: string | null;
}

export interface EventoVcs {
  workspace_id: string;
  mission_id: string | null;
  resumo: ResumoVcs;
}

// ---- diff -----------------------------------------------------------------------------------

export interface PedidoDiff extends AlvoVcs {
  caminho: string | null;
  staged: boolean;
  base: string | null;
  palavra: boolean;
  contexto: number | null;
  nao_rastreado: boolean;
  limite_bytes: number | null;
}

// ---- famílias de operações --------------------------------------------------------------------

export type Familia = Record<string, { entrada: object; saida: unknown }>;
/** `{op, ...entrada}` para cada operação da família. */
export type PedidoDe<F extends Familia> = { [K in keyof F & string]: { op: K } & F[K]["entrada"] }[keyof F & string];
export type SaidaDe<F extends Familia> = F[keyof F]["saida"];
type Ok = { ok: true };
/** Op sem campos próprios (`object`, não `Record<string, never>`: este anularia `op`). */
type Vazio = object;

/** Escolha do estado na linha de comando de `confirmacao`: o nome do branch digitado (D-36). */
export type OperacoesEstagio = {
  estagiar: { entrada: { caminhos: string[] }; saida: Ok };
  desestagiar: { entrada: { caminhos: string[] }; saida: Ok };
  /** `linhas` null = hunk inteiro; senão os índices das linhas (add/del) do hunk. */
  hunk: { entrada: { sentido: "estagiar" | "desestagiar"; caminho: string; hunk: number; linhas: number[] | null }; saida: Ok };
  ignorar: { entrada: { padroes: string[] }; saida: { adicionados: string[]; ja_existiam: string[] } };
  /** `simular: true` devolve o que se perderia; sem simular exige `confirmar: true`. Rede de segurança: cópia + lixeira. */
  descartar: { entrada: { caminhos: string[]; incluir_staged: boolean; simular: boolean; confirmar: boolean }; saida: ResultadoDescartar };
  desfazer_descarte: { entrada: { id: string }; saida: ResultadoDesfazer };
  descartes_listar: { entrada: Vazio; saida: Array<{ id: string; criadoEm: string; arquivos: string[]; desfeito: boolean }> };
}

export type OperacoesCommit = {
  criar: { entrada: { mensagem: string | null; amend: boolean; pular_hooks: boolean; coautores: string[] }; saida: ResultadoCommit };
  modelo: { entrada: Vazio; saida: { modelo: string | null } };
  ultimo_publicado: { entrada: Vazio; saida: { publicado: boolean; remotas: string[] } };
}

export type OperacoesRamos = {
  listar: { entrada: { remotos: boolean }; saida: RamoDetalhe[] };
  criar: { entrada: { nome: string; de: string | null; trocar: boolean }; saida: { nome: string; hash: string } };
  trocar: { entrada: { destino: string; estrategia: EstrategiaTroca | null }; saida: ResultadoTrocar };
  renomear: { entrada: { de: string; para: string }; saida: Ok };
  /** `forcar` exige `confirmacao` = nome do ramo, digitado; sem `forcar`, o git recusa ramo não mesclado. */
  apagar: { entrada: { nome: string; forcar: boolean; simular: boolean; confirmacao: string | null }; saida: ResultadoApagarRamo };
  upstream_definir: { entrada: { ramo: string; upstream: string }; saida: Ok };
  upstream_remover: { entrada: { ramo: string }; saida: Ok };
  padrao: { entrada: Vazio; saida: { nome: string | null } };
  tags_listar: { entrada: Vazio; saida: TagInfo[] };
  tag_criar: { entrada: { nome: string; de: string | null; mensagem: string | null }; saida: { nome: string; hash: string; tipo: "leve" | "anotada" } };
  tag_apagar: { entrada: { nome: string }; saida: { objetoAnterior: string } };
  worktrees_listar: { entrada: { com_estado: boolean }; saida: WorktreeEstado[] };
}

export type OperacoesStash = {
  listar: { entrada: Vazio; saida: Stash[] };
  criar: { entrada: { mensagem: string | null; nao_rastreados: boolean; manter_indice: boolean }; saida: { criado: boolean; ref: string | null; hash: string | null } };
  aplicar: { entrada: { indice: number; restaurar_indice: boolean }; saida: ResultadoAplicar };
  pop: { entrada: { indice: number; restaurar_indice: boolean }; saida: ResultadoAplicar };
  apagar: { entrada: { indice: number }; saida: { hash: string; mensagem: string } };
  restaurar_apagado: { entrada: { hash: string; mensagem: string }; saida: Ok };
  diff: { entrada: { indice: number }; saida: Diff };
}

export interface CursorLogEntrada {
  hash: string;
  indice: number;
  pistas: Array<string | null>;
}

export type OperacoesHistorico = {
  log: {
    entrada: { limite: number | null; cursor: CursorLogEntrada | null; rev: string | null; todos: boolean; busca: string | null; regex: boolean; autor: string | null; caminho: string | null };
    saida: PaginaLog;
  };
  arquivo: { entrada: { caminho: string; limite: number | null }; saida: CommitLog[] };
  detalhe: { entrada: { rev: string }; saida: DetalheCommit };
  blame: { entrada: { caminho: string; rev: string | null }; saida: LinhaBlame[] };
  reflog: { entrada: { ramo: string | null; limite: number | null }; saida: EntradaReflog[] };
  /** Desfaz a última operação (rede de segurança do reflog); `simular` primeiro. */
  desfazer_ultima: { entrada: { simular: boolean }; saida: ResultadoDesfazerOperacao };
}

/** Rede só por ação explícita do usuário. `lease` (única via de push forçado) exige `confirmacao` = nome do ramo digitado. */
export type OperacoesRemoto = {
  listar: { entrada: Vazio; saida: Remoto[] };
  fetch: { entrada: { remoto: string | null; todos: boolean; podar: boolean }; saida: ResultadoFetch };
  pull: { entrada: { modo: ModoPull | null; remoto: string | null; ramo: string | null; simular: boolean }; saida: ResultadoPull };
  push: { entrada: { remoto: string | null; ramo: string | null }; saida: ResultadoPush };
  lease: { entrada: { remoto: string | null; ramo: string; ref_esperada: string; confirmacao: string | null; simular: boolean }; saida: ResultadoLease };
  preferencia_pull: { entrada: Vazio; saida: { preferencia: string | null } };
}

export type OperacoesOperacao = {
  estado: { entrada: Vazio; saida: EstadoOperacao };
  mesclar: { entrada: { rev: string; sem_ff: boolean; squash: boolean; mensagem: string | null; simular: boolean }; saida: ResultadoOperacao };
  cherry_pick: { entrada: { revs: string[]; mainline: number | null; simular: boolean }; saida: ResultadoOperacao };
  reverter: { entrada: { revs: string[]; mainline: number | null; simular: boolean }; saida: ResultadoOperacao };
  rebase: { entrada: { base: string; simular: boolean }; saida: ResultadoOperacao };
  rebase_interativo: { entrada: { base: string; passos: PassoRebase[]; simular: boolean; forcar: boolean }; saida: ResultadoOperacao };
  continuar: { entrada: Vazio; saida: ResultadoOperacao };
  abortar: { entrada: Vazio; saida: ResultadoOperacao };
  pular: { entrada: Vazio; saida: ResultadoOperacao };
}

export type OperacoesConflitos = {
  listar: { entrada: Vazio; saida: InfoConflito[] };
  ler: { entrada: { caminho: string }; saida: ArquivoConflito & { info: InfoConflito; eol: "lf" | "crlf" } };
  /** `marcar` já faz `git add` quando não restam hunks. */
  resolver_hunks: { entrada: { caminho: string; resolucoes: Record<string, Resolucao>; marcar: boolean }; saida: { restantes: number; marcado: boolean } };
  resolver_arquivo: { entrada: { caminho: string; escolha: OpcaoArquivo }; saida: Ok };
  marcar_resolvido: { entrada: { caminho: string }; saida: Ok };
}

/** SVN: o que não existe no git. Operações que gravam no servidor exigem `confirmado_servidor: true` (nunca automático). */
export interface InfoSvnUi {
  /** Caminho relativo `^/trunk`. */
  url_relativa: string;
  url: string;
  revisao: number;
  ultima_revisao: number | null;
  ultimo_autor: string | null;
  raiz_repositorio: string;
}

export type OperacoesSvn = {
  info: { entrada: Vazio; saida: InfoSvnUi };
  status_servidor: { entrada: Vazio; saida: StatusRepo };
  atualizar: { entrada: { revisao: number | null; caminhos: string[] | null }; saida: ResultadoUpdate };
  commit: { entrada: { mensagem: string; caminhos: string[] | null; changelist: string | null }; saida: ResultadoCommitSvn };
  adicionar: { entrada: { caminhos: string[] }; saida: Ok };
  remover: { entrada: { caminhos: string[]; manter_local: boolean }; saida: Ok };
  /** Descarta mudanças locais com cópia de segurança. */
  reverter: { entrada: { caminhos: string[]; confirmar: boolean }; saida: { backup: string | null } };
  resolver: { entrada: { caminhos: string[]; aceitar: EscolhaResolver }; saida: Ok };
  limpar: { entrada: Vazio; saida: Ok };
  log: { entrada: { limite: number | null; desde: number | null; caminho: string | null }; saida: PaginaLogSvn };
  blame: { entrada: { caminho: string; revisao: number | null }; saida: LinhaBlameSvn[] };
  conflitos: { entrada: Vazio; saida: ConflitoSvn[] };
  ramos_listar: { entrada: { tipo: "branches" | "tags" }; saida: string[] };
  trocar: { entrada: { destino: string }; saida: ResultadoUpdate };
  mesclar: { entrada: { de: string; revisoes: number[]; simular: boolean }; saida: ResultadoMergeSvn };
  /** Grava no servidor: `confirmado_servidor` precisa ser true. */
  ramo_criar: { entrada: { tipo: "branch" | "tag"; nome: string; mensagem: string | null; confirmado_servidor: boolean }; saida: unknown };
  auth_verificar: { entrada: Vazio; saida: EstadoAutenticacaoSvn };
}

/** Forge (GitHub/GitLab/Bitbucket/Azure): leituras e criação de PR por ação do usuário. Merge de PR NÃO está aqui (humano, na mergex/forge). */
export type OperacoesForge = {
  estado: { entrada: Vazio; saida: { forge: EstadoForge | null; provedor: ProvedorForge | null } };
  prs_listar: { entrada: { estado: "aberto" | "fechado" | "mesclado" | "todos"; limite: number | null }; saida: { itens: PrResumo[]; truncado: boolean } };
  pr_ver: { entrada: { numero: number }; saida: PrDetalhe };
  pr_criar: { entrada: { titulo: string; corpo: string | null; base: string | null; head: string | null; rascunho: boolean }; saida: PrResumo };
  checks_do_pr: { entrada: { numero: number }; saida: CheckForge[] };
  issues_listar: { entrada: { estado: "aberta" | "fechada" | "todas"; limite: number | null }; saida: IssueResumo[] };
}

// ---- Missão ↔ VCS (T-06.34) -------------------------------------------------------------------

export interface MissaoVcs {
  mission_id: string;
  tipo: TipoVcs;
  branch: string | null;
  /** Relativo à raiz do workspace (`../repo--slug`); null = Missão sem árvore própria. */
  worktree: string | null;
  base: string | null;
  /** A pasta da Missão ainda existe no disco. */
  existe: boolean;
  resumo: ResumoVcs | null;
  /** PR da Missão pelo forge, quando há remoto/CLI e o usuário já abriu o PR (só lido). */
  pr: { numero: number; url: string; estado: string; checks_falhando: number; checks_pendentes: number } | null;
  /** Sinaleira do PR (checks vermelhos = amarela, com motivo) e se o `ENTREGA.md` do disco está atrás do forge (só sinalizado, nunca reescrito). */
  pr_sinaleira: { cor: "verde" | "amarela" | "neutra"; motivo: string | null; entrega_desatualizada: boolean } | null;
}

/** Commit registrado em `ENTREGA.md` (`commits[{task, commit}]`) — lido, nunca escrito (D-04). */
export interface CommitDaMissao {
  task: string | null;
  commit: string;
  assunto: string | null;
  /** O hash existe no repositório desta árvore. */
  existe: boolean;
}

export type OperacoesMissao = {
  resumo: { entrada: Vazio; saida: MissaoVcs };
  commits: { entrada: Vazio; saida: CommitDaMissao[] };
  /** Diff da Missão contra a base (`base...HEAD`). */
  diff_base: { entrada: { caminho: string | null }; saida: Diff };
  comparar: { entrada: Vazio; saida: ComparacaoBase };
}

// ---- pedidos de IPC (entrada flatten: alvo + op + campos) -------------------------------------

export type PedidoFamilia<F extends Familia> = AlvoVcs & PedidoDe<F>;
export type PedidoMissao = { mission_id: string } & PedidoDe<OperacoesMissao>;

/** Tipos de resposta/pedido de cada canal de operação (usados por `CanaisInvoke`). */
export type FamiliasVcs = {
  "vcs:estagio": OperacoesEstagio;
  "vcs:commit": OperacoesCommit;
  "vcs:ramos": OperacoesRamos;
  "vcs:stash": OperacoesStash;
  "vcs:historico": OperacoesHistorico;
  "vcs:remoto": OperacoesRemoto;
  "vcs:operacao": OperacoesOperacao;
  "vcs:conflitos": OperacoesConflitos;
  "vcs:svn": OperacoesSvn;
  "vcs:forge": OperacoesForge;
}

/** Eventos de auditoria gravados em `evento_dominio` (sem segredo, caminhos relativos). */
export const TIPOS_EVENTO_VCS = ["vcs.commit", "vcs.descartar", "vcs.ramo", "vcs.stash", "vcs.remoto", "vcs.operacao", "vcs.conflito", "vcs.svn", "vcs.forge"] as const;
export type TipoEventoVcs = (typeof TIPOS_EVENTO_VCS)[number];

// ---- API do preload (`window.ade.vcs`) --------------------------------------------------------

type Args<F extends Familia, K extends keyof F & string> = F[K]["entrada"];
type Res<F extends Familia, K extends keyof F & string> = F[K]["saida"];

/** `args` de operação sem campos (`Vazio`) pode ser omitido (o preload manda `{}`). */
export interface ApiVcs {
  estado(alvo: AlvoVcs, ignorados?: boolean): Promise<EstadoVcs>;
  observar(alvo: AlvoVcs, ativo: boolean): Promise<ResumoVcs>;
  diff(pedido: PedidoDiff): Promise<Diff>;
  estagio<K extends keyof OperacoesEstagio & string>(alvo: AlvoVcs, op: K, args: Args<OperacoesEstagio, K>): Promise<Res<OperacoesEstagio, K>>;
  commit<K extends keyof OperacoesCommit & string>(alvo: AlvoVcs, op: K, args: Args<OperacoesCommit, K>): Promise<Res<OperacoesCommit, K>>;
  ramos<K extends keyof OperacoesRamos & string>(alvo: AlvoVcs, op: K, args: Args<OperacoesRamos, K>): Promise<Res<OperacoesRamos, K>>;
  stash<K extends keyof OperacoesStash & string>(alvo: AlvoVcs, op: K, args: Args<OperacoesStash, K>): Promise<Res<OperacoesStash, K>>;
  historico<K extends keyof OperacoesHistorico & string>(alvo: AlvoVcs, op: K, args: Args<OperacoesHistorico, K>): Promise<Res<OperacoesHistorico, K>>;
  remoto<K extends keyof OperacoesRemoto & string>(alvo: AlvoVcs, op: K, args: Args<OperacoesRemoto, K>): Promise<Res<OperacoesRemoto, K>>;
  operacao<K extends keyof OperacoesOperacao & string>(alvo: AlvoVcs, op: K, args: Args<OperacoesOperacao, K>): Promise<Res<OperacoesOperacao, K>>;
  conflitos<K extends keyof OperacoesConflitos & string>(alvo: AlvoVcs, op: K, args: Args<OperacoesConflitos, K>): Promise<Res<OperacoesConflitos, K>>;
  svn<K extends keyof OperacoesSvn & string>(alvo: AlvoVcs, op: K, args: Args<OperacoesSvn, K>): Promise<Res<OperacoesSvn, K>>;
  forge<K extends keyof OperacoesForge & string>(alvo: AlvoVcs, op: K, args: Args<OperacoesForge, K>): Promise<Res<OperacoesForge, K>>;
  missao<K extends keyof OperacoesMissao & string>(missionId: string, op: K, args: Args<OperacoesMissao, K>): Promise<Res<OperacoesMissao, K>>;
  assinar(cb: (e: EventoVcs) => void): () => void;
}
