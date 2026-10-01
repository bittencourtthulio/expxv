// Contrato comum de versionamento (T-06.01). Git e SVN ficam atrás da mesma interface `Vcs`;
// a UI pergunta `capabilities` e degrada com clareza. Todos os tipos de dados são objetos simples
// (clonáveis por IPC / structuredClone), sem classes nem funções.

import type { VcsGitOperacoes } from "./git/vcs-git";

export type TipoVcs = "git" | "svn" | "git-svn" | "nenhum";

export interface Capabilities {
  /** Área de preparação (índice) e stage por arquivo/hunk/linha. */
  stage: boolean;
  stash: boolean;
  worktree: boolean;
  /** Remotos (fetch/pull/push). SVN fala com o servidor em update/commit, mas não tem "remoto" separado. */
  remoto: boolean;
  blame: boolean;
  ramos: boolean;
  historico: boolean;
  /** Commit parcial por hunk/linha. */
  commitParcial: boolean;
  /** Merge/rebase/cherry-pick com estado de operação em curso. */
  operacoes: boolean;
}

export const CAPABILITIES_GIT: Readonly<Capabilities> = Object.freeze({
  stage: true, stash: true, worktree: true, remoto: true, blame: true, ramos: true, historico: true, commitParcial: true, operacoes: true,
});
export const CAPABILITIES_SVN: Readonly<Capabilities> = Object.freeze({
  stage: false, stash: false, worktree: false, remoto: false, blame: true, ramos: false, historico: true, commitParcial: false, operacoes: false,
});
export const CAPABILITIES_NENHUM: Readonly<Capabilities> = Object.freeze({
  stage: false, stash: false, worktree: false, remoto: false, blame: false, ramos: false, historico: false, commitParcial: false, operacoes: false,
});

export function capabilitiesDe(tipo: TipoVcs, svnDisponivel = true): Capabilities {
  if (tipo === "git" || tipo === "git-svn") return { ...CAPABILITIES_GIT };
  if (tipo === "svn") return svnDisponivel ? { ...CAPABILITIES_SVN } : { ...CAPABILITIES_NENHUM };
  return { ...CAPABILITIES_NENHUM };
}

// ---- Status ----------------------------------------------------------------------------------

/** Letra XY do porcelain: ' ' sem mudança, M modificado, T tipo, A novo, D apagado, R renomeado, C copiado, U conflito. */
export type LetraMudanca = " " | "M" | "T" | "A" | "D" | "R" | "C" | "U";

export type CodigoConflito =
  | "ambos-modificaram" // UU
  | "ambos-adicionaram" // AA
  | "ambos-apagaram" // DD
  | "adicionado-por-nos" // AU
  | "adicionado-por-eles" // UA
  | "apagado-por-nos" // DU
  | "apagado-por-eles"; // UD

export type TipoMudanca = "ordinario" | "renomeado" | "copiado" | "conflito" | "naorastreado" | "ignorado";

export interface Mudanca {
  /** Relativo à raiz, com `/`. */
  caminho: string;
  /** Origem de renomeado/copiado. */
  origem?: string;
  tipo: TipoMudanca;
  /** Estado no índice (staged). */
  indice: LetraMudanca;
  /** Estado na árvore de trabalho (não staged). */
  arvore: LetraMudanca;
  conflito?: CodigoConflito;
  /** Entrada é um submódulo; flags: C commit novo, M modificado, U não rastreados. */
  submodulo?: string;
}

export interface ContagensStatus {
  staged: number;
  naoStaged: number;
  naoRastreados: number;
  conflitos: number;
  ignorados: number;
}

export interface StatusRepo {
  /** `calculando`: primeiro cálculo em curso (a UI mostra esqueleto, nunca trava). */
  estado: "pronto" | "calculando";
  /** null em HEAD destacado. */
  branch: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  semCommits: boolean;
  arquivos: Mudanca[];
  contagens: ContagensStatus;
  /** Calculado com `-uno` (não rastreados omitidos) por demora. */
  degradado: boolean;
  /** Atualizado de forma incremental (status só dos caminhos que mudaram, mesclado ao anterior). */
  parcial?: true;
  duracaoMs: number;
}

// ---- Diff ------------------------------------------------------------------------------------

export type TipoLinha = "ctx" | "add" | "del";

export interface ParteLinha {
  tipo: TipoLinha;
  texto: string;
}

export interface LinhaDiff {
  /** `mod`: só no `--word-diff`, linha com trechos removidos E adicionados (ver `partes`). */
  tipo: TipoLinha | "mod";
  /** Sem o `\r` final (ver `DiffArquivo.eol`). */
  texto: string;
  /** Número na versão antiga (null em linha adicionada). */
  antiga: number | null;
  /** Número na versão nova (null em linha removida). */
  nova: number | null;
  /** `\ No newline at end of file` logo depois desta linha. */
  semFim?: true;
  /** Somente no modo `--word-diff`: fragmentos da linha. */
  partes?: ParteLinha[];
}

export interface Hunk {
  cabecalho: string;
  antigaInicio: number;
  antigaQtd: number;
  novaInicio: number;
  novaQtd: number;
  /** Trecho depois do `@@`, tipicamente o nome da função. */
  secao: string;
  linhas: LinhaDiff[];
  /** O diff acabou no meio deste hunk (saída truncada). */
  incompleto?: true;
}

export type EstadoArquivoDiff = "modificado" | "novo" | "apagado" | "renomeado" | "copiado";

export interface DiffArquivo {
  /** Caminho novo (ou o único). */
  caminho: string;
  /** Caminho antigo (difere em renomeado/copiado). */
  caminhoAntigo: string;
  estado: EstadoArquivoDiff;
  binario: boolean;
  /** Similaridade 0-100 de renomeado/copiado. */
  similaridade?: number;
  modoAntigo?: string;
  modoNovo?: string;
  mudouModo: boolean;
  /** Fim de linha dominante nas linhas alteradas. */
  eol: "lf" | "crlf" | "misto" | null;
  /** Só o fim de linha mudou (conteúdo igual). */
  soFimDeLinha: boolean;
  submodulo?: { de: string | null; para: string | null; sujo: boolean };
  insercoes: number;
  delecoes: number;
  hunks: Hunk[];
}

export interface Diff {
  arquivos: DiffArquivo[];
  /** A saída foi cortada (limite de bytes ou comando encerrado): o último arquivo/hunk pode estar incompleto. */
  truncado: boolean;
  /** Marcação para a UI: "diff grande, mostrar sob demanda". */
  grande: boolean;
}

// ---- Histórico e ramos -----------------------------------------------------------------------

export interface Commit {
  hash: string;
  hashCurto: string;
  pais: string[];
  autor: string;
  email: string;
  /** ISO 8601. */
  data: string;
  assunto: string;
}

export interface Ramo {
  nome: string;
  atual: boolean;
  remoto: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  hash: string;
}

// ---- Interface ------------------------------------------------------------------------------

export interface OpcoesLeitura {
  signal?: AbortSignal;
}

export interface OpcoesStatus extends OpcoesLeitura {
  /** Inclui ignorados (padrão false). */
  ignorados?: boolean;
}

export interface OpcoesDiff extends OpcoesLeitura {
  /** Caminho relativo à raiz; sem ele, o repositório todo. */
  caminho?: string;
  /** Diff do índice contra HEAD (staged). */
  staged?: boolean;
  /** Contra uma base: `base...HEAD`. */
  base?: string;
  /** `--word-diff=porcelain`. */
  palavra?: boolean;
  contexto?: number;
  limiteBytes?: number;
  /** Arquivo NÃO rastreado: mostra o conteúdo inteiro como adicionado (`caminho` obrigatório). */
  naoRastreado?: boolean;
}

export interface Vcs {
  readonly tipo: TipoVcs;
  /** Raiz (caminho real) da árvore de trabalho. */
  readonly raiz: string;
  readonly capabilities: Capabilities;
  status(op?: OpcoesStatus): Promise<StatusRepo>;
  diff(op?: OpcoesDiff): Promise<Diff>;
  /** Operações de escrita/ramos/stash/worktrees do git (6B). Ausente em SVN: a UI consulta `capabilities`. */
  readonly git?: VcsGitOperacoes;
}
