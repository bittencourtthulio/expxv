// T-06.22 · Interface `Forge` única (GitHub, GitLab, Bitbucket, Azure DevOps). Nenhuma tela/camada importa um adaptador
// concreto: só `forge/index.ts` (fábrica) e este contrato. Credenciais são SEMPRE as do usuário (`gh`/`glab`, ou o cofre do
// SO injetado nos provedores só-REST); o app nunca lê, guarda, loga nem põe token em argv/erro/evento (D-33/D-34).

export type ProvedorForge = "github" | "gitlab" | "bitbucket" | "azure";
export type OrigemForge = "usuario" | "automacao";

/** Toda escrita carrega a origem; `automacao` só passa com aprovação explícita injetada e NUNCA mescla. */
export interface OpcoesEscrita {
  origem: OrigemForge;
  aprovacao?: () => boolean | Promise<boolean>;
  signal?: AbortSignal;
}
export interface OpcoesLeitura {
  signal?: AbortSignal;
}

/** Repositório remoto: `caminho` é `owner/repo` (GitHub), `grupo/sub/projeto` (GitLab), `workspace/repo` (Bitbucket), `org/projeto/repo` (Azure). */
export interface RepoRef {
  host: string;
  caminho: string;
}

export type EstadoPr = "aberto" | "fechado" | "mesclado";
export type DecisaoRevisao = "aprovado" | "mudancas" | "pendente" | "nenhuma";
export type MetodoMerge = "merge" | "squash" | "rebase";
export type SituacaoCheck = "sucesso" | "falha" | "pendente" | "cancelado" | "ignorado" | "desconhecido";

export interface ResumoChecks {
  total: number;
  sucesso: number;
  falha: number;
  pendente: number;
}
export interface PrResumo {
  numero: number;
  titulo: string;
  estado: EstadoPr;
  rascunho: boolean;
  autor: string;
  ramoOrigem: string;
  ramoDestino: string;
  url: string;
  criadoEm: string;
  atualizadoEm: string;
  labels: string[];
  revisao: DecisaoRevisao;
  checks: ResumoChecks | null;
}
export interface ArquivoPr {
  caminho: string;
  adicoes: number;
  remocoes: number;
}
export interface ComentarioForge {
  autor: string;
  corpo: string;
  criadoEm: string;
  caminho?: string;
  linha?: number;
}
export interface ReviewForge {
  autor: string;
  estado: DecisaoRevisao | "comentado";
  corpo: string;
  criadoEm: string;
}
export interface CheckForge {
  nome: string;
  situacao: SituacaoCheck;
  url: string;
  workflow?: string;
  iniciadoEm?: string;
  concluidoEm?: string;
}
export interface PrDetalhe extends PrResumo {
  corpo: string;
  arquivos: ArquivoPr[];
  comentarios: ComentarioForge[];
  reviews: ReviewForge[];
  checksDetalhe: CheckForge[];
  mesclavel: "sim" | "nao" | "desconhecido";
  /** Algum campo grande foi cortado (corpo, comentários, lista de arquivos). */
  truncado: boolean;
}
export interface FiltroPr {
  estado?: EstadoPr | "todos";
  autor?: string;
  label?: string;
  base?: string;
  head?: string;
  busca?: string;
  rascunho?: boolean;
  limite?: number;
}
export interface EntradaCriarPr {
  titulo: string;
  corpo?: string;
  /** Caminho de arquivo (ex.: `PR.md` do mergex) lido pelo app; vence `corpo` quando existe e é legível. */
  corpoArquivo?: string;
  base?: string;
  head?: string;
  rascunho?: boolean;
  revisores?: string[];
  labels?: string[];
}
export interface EntradaMesclar {
  metodo?: MetodoMerge;
  apagarBranch?: boolean;
}
export type AcaoReview = "aprovar" | "pedir-mudancas" | "comentar";
export interface LocalLinha {
  caminho: string;
  linha: number;
  lado?: "direita" | "esquerda";
}
export interface ExecucaoCi {
  id: string;
  nome: string;
  situacao: SituacaoCheck;
  ramo: string;
  evento: string;
  url: string;
  criadoEm: string;
  atualizadoEm: string;
}
export interface FiltroExecucao {
  ramo?: string;
  workflow?: string;
  situacao?: SituacaoCheck;
  limite?: number;
}
export interface OpcoesLog extends OpcoesLeitura {
  /** Cada pedaço do log, em streaming (nada é acumulado aqui). */
  aoPedaco: (texto: string) => void;
  somenteFalhos?: boolean;
  /** Teto de bytes (padrão 128 MiB); acima disso o processo é encerrado e `truncado` volta true. */
  maxBytes?: number;
}
export interface ResultadoLog {
  bytes: number;
  truncado: boolean;
}
export interface IssueResumo {
  numero: number;
  titulo: string;
  estado: "aberta" | "fechada";
  autor: string;
  labels: string[];
  url: string;
  criadoEm: string;
  atualizadoEm: string;
}
export interface IssueDetalhe extends IssueResumo {
  corpo: string;
  comentarios: ComentarioForge[];
  truncado: boolean;
}
export interface FiltroIssue {
  estado?: "aberta" | "fechada" | "todas";
  autor?: string;
  label?: string;
  busca?: string;
  limite?: number;
}
export interface EntradaCriarIssue {
  titulo: string;
  corpo?: string;
  labels?: string[];
}
export interface LimiteApi {
  limite: number;
  restante: number;
  /** Epoch em segundos em que a janela reinicia. */
  reiniciaEm: number;
}
/** Consulta barata de um PR para o polling (T-06.21): `naoModificado` quando o ETag ainda vale. */
export interface ConsultaPr {
  naoModificado: boolean;
  etag?: string;
  pr?: PrResumo;
  limite?: LimiteApi | null;
}

export interface CapacidadesForge {
  prs: { listar: boolean; ver: boolean; criar: boolean; checkout: boolean; atualizarBranch: boolean; mesclar: boolean; fechar: boolean; prontoParaRevisao: boolean; revisar: boolean; comentar: boolean; comentarEmLinha: boolean; revisores: boolean; labels: boolean; rascunho: boolean; etag: boolean };
  checks: { doPr: boolean; execucoes: boolean; log: boolean; reexecutarFalhos: boolean };
  issues: { listar: boolean; ver: boolean; criar: boolean; comentar: boolean };
  metodosMerge: MetodoMerge[];
  limiteApi: boolean;
}

/** Estado da CLI/credencial do provedor: sempre claro, nunca com token. */
export interface ContaForge {
  host: string;
  usuario: string | null;
  ativa: boolean;
  protocolo?: string;
}
export interface EstadoForge {
  provedor: ProvedorForge;
  cli: { nome: string; instalada: boolean; versao: string | null };
  autenticado: boolean;
  contas: ContaForge[];
  repo: RepoRef | null;
  /** Funcionamento degradado (só git, sem forge) quando true. */
  degradado: boolean;
  /** Próximo passo para o usuário (instalar/entrar), quando houver. */
  instrucao: string | null;
}

export interface Forge {
  readonly provedor: ProvedorForge;
  readonly repo: RepoRef;
  detectar(op?: OpcoesLeitura): Promise<EstadoForge>;
  capacidades(): CapacidadesForge;
  limiteApi(op?: OpcoesLeitura): Promise<LimiteApi | null>;
  prs: {
    listar(filtro?: FiltroPr, op?: OpcoesLeitura): Promise<{ itens: PrResumo[]; truncado: boolean }>;
    ver(numero: number, op?: OpcoesLeitura): Promise<PrDetalhe>;
    /** Resumo leve (+ETag quando o provedor suporta) para o polling. */
    consultar(numero: number, etag?: string, op?: OpcoesLeitura): Promise<ConsultaPr>;
    criar(entrada: EntradaCriarPr, e: OpcoesEscrita): Promise<PrResumo>;
    checkout(numero: number, e: OpcoesEscrita): Promise<void>;
    atualizarBranch(numero: number, e: OpcoesEscrita & { rebase?: boolean }): Promise<void>;
    mesclar(numero: number, entrada: EntradaMesclar, e: OpcoesEscrita): Promise<{ metodo: MetodoMerge }>;
    fechar(numero: number, e: OpcoesEscrita & { comentario?: string }): Promise<void>;
    prontoParaRevisao(numero: number, e: OpcoesEscrita): Promise<void>;
    revisar(numero: number, entrada: { acao: AcaoReview; corpo?: string }, e: OpcoesEscrita): Promise<void>;
    comentar(numero: number, corpo: string, e: OpcoesEscrita & { local?: LocalLinha }): Promise<void>;
  };
  checks: {
    doPr(numero: number, op?: OpcoesLeitura): Promise<CheckForge[]>;
    execucoes(filtro?: FiltroExecucao, op?: OpcoesLeitura): Promise<ExecucaoCi[]>;
    log(id: string, op: OpcoesLog): Promise<ResultadoLog>;
    reexecutarFalhos(id: string, e: OpcoesEscrita): Promise<void>;
  };
  issues: {
    listar(filtro?: FiltroIssue, op?: OpcoesLeitura): Promise<IssueResumo[]>;
    ver(numero: number, op?: OpcoesLeitura): Promise<IssueDetalhe>;
    criar(entrada: EntradaCriarIssue, e: OpcoesEscrita): Promise<IssueResumo>;
    comentar(numero: number, corpo: string, e: OpcoesEscrita): Promise<void>;
  };
}
