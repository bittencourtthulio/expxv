// Tipos do versionamento que o renderer precisa e que moram em módulos do núcleo que usam Node (git/svn/forge).
// O renderer não compila esses módulos (sem tipos de Node); por isso as formas estão aqui. Sentido único de
// conformidade: o main devolve valores do núcleo onde o contrato pede estes tipos, então `tsc` do main falha se divergirem
// (os tipos de cá são subconjuntos estruturais dos de lá). Tipos puros (status, diff, commit…) vêm de `nucleo/vcs/tipos`.

import type { Commit, Diff } from "../nucleo/vcs/tipos";

export interface DiffItem {
  caminho: string;
  insercoes: number;
  delecoes: number;
}
export interface DiffStat {
  arquivos: number;
  insercoes: number;
  delecoes: number;
  itens: DiffItem[];
}

export interface CommitLog extends Commit {
  /** Decorações (`HEAD -> main`, `origin/main`, `tag: v1`). */
  refs: string[];
}

/** Uma linha do grafo. Colunas são índices de pista (0 = esquerda). */
export interface LinhaGrafo {
  hash: string;
  coluna: number;
  entra: number[];
  passa: number[];
  saidas: number[];
  largura: number;
}

export interface CursorLog {
  hash: string;
  indice: number;
  pistas: Array<string | null>;
}

export interface PaginaLog {
  commits: CommitLog[];
  grafo: LinhaGrafo[] | null;
  proximo: CursorLog | null;
  duracaoMs: number;
}

export interface DetalheCommit extends CommitLog {
  corpo: string;
  commiter: string;
  diff: Diff;
  insercoes: number;
  delecoes: number;
}

export interface LinhaBlame {
  linha: number;
  linhaOriginal: number;
  hash: string;
  autor: string;
  email: string;
  data: string;
  resumo: string;
  limite: boolean;
  arquivo: string;
  conteudo: string;
}

export interface CommitResumo {
  hash: string;
  assunto: string;
  autor: string;
  data: string;
}

export interface RamoDetalhe {
  nome: string;
  atual: boolean;
  remoto: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  hash: string;
  ref: string;
  upstreamSumiu: boolean;
  ultimoCommit: CommitResumo;
}

export interface ResultadoApagarRamo {
  apagado: boolean;
  simulado: boolean;
  orfaos: CommitResumo[];
  requerForcar: boolean;
  hashAnterior: string;
}

export type EstrategiaTroca = "cancelar" | "levar" | "stash";
export type ResultadoTrocar =
  | { trocou: true; de: string | null; para: string; levouMudancas: boolean; stashCriado: string | null; conflitoAoReaplicar: boolean; arquivos: string[] }
  | { trocou: false; conflito: true; arquivos: string[]; opcoes: readonly EstrategiaTroca[] };

export interface TagInfo {
  nome: string;
  tipo: "leve" | "anotada";
  hash: string;
  mensagem: string | null;
  autor: string | null;
  data: string | null;
}

export interface ResultadoCommit {
  hash: string;
  hashCurto: string;
  assunto: string;
  amend: boolean;
  hooksPulados: boolean;
  avisos: string[];
  saida: string;
}

export interface Stash {
  indice: number;
  ref: string;
  hash: string;
  mensagem: string;
  ramo: string | null;
  data: string;
}

export interface ResultadoAplicar {
  aplicado: boolean;
  conflito: boolean;
  arquivos: string[];
  stashMantido: boolean;
  motivo?: string;
}

export interface WorktreeEstado {
  caminho: string;
  head: string | null;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  principal: boolean;
  existe: boolean;
  orfao: boolean;
  motivoOrfao: string | null;
  motivoTravamento: string | null;
  sujo: boolean | null;
  arquivosAlterados: number;
}

export interface ComparacaoBase {
  base: string;
  ahead: number;
  behind: number;
  diffStat: DiffStat;
}

export type TipoOperacaoReflog = "commit" | "commit-inicial" | "amend" | "merge" | "pull" | "rebase" | "cherry-pick" | "revert" | "checkout" | "reset" | "outro";
export interface EntradaReflog {
  indice: number;
  hash: string;
  seletor: string;
  assunto: string;
  data: string;
  tipo: TipoOperacaoReflog;
}
export type ResultadoDesfazerOperacao =
  | { seguro: false; motivo: string }
  | { seguro: true; operacao: TipoOperacaoReflog; de: string; para: string; modo: "soft" | "keep"; desfeito: boolean; mudariam: string[] };

export interface ResultadoDesfazer {
  restaurados: string[];
  conflitos: string[];
  semConteudo: string[];
}

export interface ItemDescarte {
  caminho: string;
  acao: "restaurar" | "lixeira" | "ignorado";
  motivo?: string;
  insercoes?: number;
  delecoes?: number;
}
export interface ResultadoDescartar {
  simulado: boolean;
  itens: ItemDescarte[];
  idDesfazer: string | null;
  naLixeira: string[];
}

export interface Remoto {
  nome: string;
  url: string;
  urlPush: string | null;
  credenciaisNaUrl: boolean;
}
export interface ResultadoFetch {
  remotos: string[];
  atualizacoes: number;
  duracaoMs: number;
}
export type ModoPull = "ff-only" | "merge" | "rebase" | "config";

export type Operacao = "merge" | "rebase" | "cherry-pick" | "revert";
export interface EstadoOperacao {
  operacao: Operacao | null;
  passo?: number;
  total?: number;
  ramo?: string | null;
  interativo?: boolean;
  cabeca?: string;
  parado?: "conflito" | "parado" | null;
  conflitos: string[];
}
export type AcaoRebase = "pick" | "reword" | "edit" | "squash" | "fixup" | "drop";
export interface PassoRebase {
  acao: AcaoRebase;
  hash: string;
  mensagem?: string;
}
export interface AvisoConflito {
  tipo: string;
  caminho: string;
  texto: string;
}
export interface ResultadoOperacao {
  resultado: "ok" | "ja-atualizado" | "conflito" | "parado" | "simulado";
  hash: string | null;
  conflitos: string[];
  estado: EstadoOperacao;
  avisos: AvisoConflito[];
  commits?: CommitLog[];
  conflitosPrevistos?: string[];
  descartados?: CommitLog[];
  avisosTexto?: string[];
  saida: string;
}
export interface ResultadoPull {
  resultado: "ok" | "ja-atualizado" | "conflito" | "simulado";
  modoUsado: ModoPull;
  antes: string | null;
  depois: string | null;
  entrariam?: CommitLog[];
  estado?: EstadoOperacao;
}
export interface ResultadoPush {
  remoto: string;
  ramo: string;
  upstreamDefinido: boolean;
  atualizado: boolean;
}
export interface ResultadoLease {
  simulado: boolean;
  remoto: string;
  ramo: string;
  refEsperada: string;
  sobrescreveria: CommitLog[];
  enviado: boolean;
}

export type Resolucao = "nossa" | "deles" | "base" | "ambas" | { editar: string };
export interface HunkConflito {
  id: number;
  linha: number;
  rotuloNossa: string;
  rotuloDeles: string;
  rotuloBase: string | null;
  nossa: string;
  deles: string;
  base: string | null;
}
export type ParteConflito = { tipo: "texto"; texto: string } | { tipo: "conflito"; hunk: HunkConflito };
export interface ArquivoConflito {
  partes: ParteConflito[];
  hunks: HunkConflito[];
  estilo: "merge" | "diff3";
}
export type TipoConflito = "texto" | "binario" | "modo" | "adicao-dupla" | "exclusao-modificacao";
export type OpcaoArquivo = "nossa" | "deles" | "remover";
export interface InfoConflito {
  caminho: string;
  tipo: TipoConflito;
  lado?: "nos-apagamos" | "eles-apagaram" | "adicionado-por-nos" | "adicionado-por-eles" | "ambos-adicionaram";
  opcoes: OpcaoArquivo[];
  hunks: number;
}

// ---- SVN ----

export type AcaoUpdate = "adicionado" | "apagado" | "atualizado" | "conflito" | "mesclado" | "existia" | "substituido" | "restaurado";
export interface ItemUpdate {
  acao: AcaoUpdate;
  propriedade: AcaoUpdate | null;
  caminho: string;
  arvore: boolean;
}
export interface ResultadoUpdate {
  revisao: number | null;
  itens: ItemUpdate[];
  conflitos: ItemUpdate[];
  resumo: string;
}
export interface ResultadoCommitSvn {
  revisao: number | null;
  saida: string;
}
export interface ConflitoSvn {
  caminho: string;
  tipo: "texto" | "propriedade" | "arvore";
}
export interface CaminhoLogSvn {
  acao: "A" | "M" | "D" | "R";
  tipo: "file" | "dir";
  caminho: string;
  copiadoDe?: string;
  copiadoRev?: number;
}
export interface EntradaLogSvn {
  revisao: number;
  autor: string;
  data: string;
  mensagem: string;
  caminhos: CaminhoLogSvn[];
}
export interface PaginaLogSvn {
  entradas: EntradaLogSvn[];
  proximo: number | null;
}
export interface LinhaBlameSvn {
  linha: number;
  revisao: number | null;
  autor: string | null;
  data: string | null;
  mesclada?: { revisao: number; autor: string | null; data: string | null; caminho: string };
  texto?: string;
}
export type EscolhaResolver = "working" | "base" | "mine-full" | "theirs-full" | "mine-conflict" | "theirs-conflict";
export interface MergeinfoSvn {
  elegiveis: number[];
  mesclados: number[];
}
export interface ResultadoMergeSvn extends ResultadoUpdate {
  simulado: boolean;
  mergeinfo: MergeinfoSvn | null;
}
export type CodigoNominalSvn = "svn_indisponivel" | "autenticacao_necessaria" | "sem_permissao" | "certificado_nao_confiavel" | "sem_rede" | "copia_bloqueada" | "conflito" | "desatualizado" | "svn_falhou";
export interface EstadoAutenticacaoSvn {
  estado: "ok" | CodigoNominalSvn;
  comandoTerminal: string | null;
  mensagem: string;
}
