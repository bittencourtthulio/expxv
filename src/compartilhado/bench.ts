// Contratos do Bench (Fase 12): tipos trocados entre núcleo, main e renderer. Ids ULID com prefixo (`btar_`, `balv_`, `brun_`, `bres_`, `bjul_`); enums PT sem
// acento; momentos UTC ISO; dinheiro em USD; desconhecido = null (NUNCA 0). O renderer nunca envia caminho, executável nem variável de ambiente: só slugs e ids.
// `mapa_cego` NÃO existe em nenhum tipo daqui: ele é interno ao núcleo e nunca atravessa um canal.

export const TIPOS_TAREFA = ["web", "codigo", "analise"] as const;
export type TipoTarefa = (typeof TIPOS_TAREFA)[number];
export const ESTADOS_TAREFA = ["rascunho", "ativa", "aposentada"] as const;
export type EstadoTarefa = (typeof ESTADOS_TAREFA)[number];
export const ORIGENS_TAREFA = ["observada_literal", "observada_parafrase", "autoral"] as const;
export type OrigemTarefa = (typeof ORIGENS_TAREFA)[number];

/** Lista fechada de checagens automatizáveis. `command_exit_zero` só aceita comandos da lista fechada do núcleo (`COMANDOS_PERMITIDOS`). */
export const TIPOS_CHECAGEM = ["file_exists", "contains_text", "command_exit_zero"] as const;
export type TipoChecagem = (typeof TIPOS_CHECAGEM)[number];
export interface ChecagemTarefa {
  tipo: TipoChecagem;
  /** `file_exists`/`contains_text`: caminho RELATIVO ao workdir; `command_exit_zero`: comando da lista fechada. */
  alvo: string;
  /** só `contains_text`. */
  texto?: string;
  /** falhou ⇒ portão de qualidade (S = C = 0). */
  critica: boolean;
}
export interface ResultadoChecagem { tipo: TipoChecagem; alvo: string; ok: boolean; critica: boolean; detalhe: string | null }

export const CRITERIOS_RUBRICA = ["functionality", "visual", "completeness", "robustness"] as const;
export type CriterioRubrica = (typeof CRITERIOS_RUBRICA)[number];

export interface TarefaBench {
  id: string;
  slug: string;
  versao: number;
  titulo: string;
  /** slug extensível (ex.: `bug`, `css`, `review`); alimenta `recomendar` e o mapa para o TaskType do harness. */
  atividade: string;
  tipo: TipoTarefa;
  prompt: string;
  escopo: string;
  checagens: ChecagemTarefa[];
  rubrica: CriterioRubrica[];
  estado: EstadoTarefa;
  origem: OrigemTarefa;
  /** a tarefa traz fixture própria (arquivos copiados para o workdir). */
  tem_fixture: boolean;
  embutida: boolean;
  atualizado_em: string;
}
export interface TarefaEditavel {
  slug: string;
  titulo: string;
  atividade: string;
  tipo: TipoTarefa;
  prompt: string;
  escopo: string;
  checagens: ChecagemTarefa[];
  estado: EstadoTarefa;
}
export type ErroTarefa = "esforco_no_prompt" | "prompt_vazio" | "checagem_invalida" | "slug_invalido" | "campo_invalido";

export const CLIS_BENCH = ["claude", "codex"] as const;
export type CliBench = (typeof CLIS_BENCH)[number];
export interface AlvoBench {
  id: string;
  /** `<provedor>-<modelo>-<esforco>`. */
  slug: string;
  provedor: string;
  modelo: string;
  esforco: string | null;
  cli: CliBench;
  /** conta DEDICADA do Bench (nunca a conta pessoal em uso); sem ela o alvo fica indisponível. */
  conta_id: string | null;
  rotulo: string;
}
export interface AlvoEditavel { provedor: string; modelo: string; esforco: string | null; cli: CliBench; conta_id: string | null; rotulo: string | null }
export interface AlvoDisponivel extends AlvoBench { disponivel: boolean; motivo: string | null }

export interface PrecoBench { provedor: string; modelo: string; preco_in_mtok: number; preco_out_mtok: number; preco_cache_mtok: number | null; vale_desde: string }

export const ESTADOS_RESULTADO = ["enfileirado", "executando", "concluido", "falhou", "tempo_esgotado", "cancelado", "interrompido", "substituido"] as const;
export type EstadoResultado = (typeof ESTADOS_RESULTADO)[number];
export const ESTADOS_RUN = ["enfileirada", "executando", "julgando", "concluida", "parcial", "cancelada", "interrompida"] as const;
export type EstadoRun = (typeof ESTADOS_RUN)[number];
export type JuizEstado = "pendente" | "feito" | "erro" | "manual";
export type CustoFonte = "relatorio_cli" | "tabela_precos" | "desconhecido";
export type CustoTipo = "medido" | "equivalente_api";
export type ModoSandbox = "macos" | "nativo_cli" | "nenhum";

export interface PesosScore { q: number; s: number; c: number }
export const PESOS_PADRAO: PesosScore = { q: 0.6, s: 0.2, c: 0.2 };
export const MAX_PARALELO = 5;
export const MAX_EXECUCOES_SEM_CUSTO = 20;
/** teto DURO de execuções por Run (achado C-02): acima disso a estimativa não oferece a frase de consentimento. */
export const MAX_EXECUCOES_POR_RUN = 100;
/** frase digitada para consentir; no modo sem sandbox (Windows, P-38) a frase é a reforçada. */
export const FRASE_CONSENTIMENTO = "RODAR";
export const FRASE_CONSENTIMENTO_SEM_SANDBOX = "RODAR SEM SANDBOX";
export const TTL_CONSENTIMENTO_S = 120;
export const MAX_LOG_PAGINA = 64 * 1024;

export interface Estimativa {
  estimativa_id: string;
  execucoes: number;
  tarefas: string[];
  alvos: string[];
  custo_min_usd: number | null;
  custo_max_usd: number | null;
  /** alvos para os quais o custo é desconhecido (mostrar "custo desconhecido para N alvos"). */
  alvos_sem_custo: number;
  duracao_estimada_s: number | null;
  sandbox: ModoSandbox | "indisponivel";
  /** o que a pessoa precisa digitar; `null` quando a Run seria recusada. */
  frase_exigida: string | null;
  teto_usd: number | null;
  avisos: string[];
}

export interface ResumoResultado {
  id: string;
  tarefa: string;
  tarefa_versao: number;
  alvo: string;
  tentativa: number;
  estado: EstadoResultado;
  duracao_s: number | null;
  custo_usd: number | null;
  custo_fonte: CustoFonte;
  tokens_out: number | null;
  qualidade: number | null;
  juiz_estado: JuizEstado;
  aviso: string | null;
}
export interface ResumoRun {
  id: string;
  nome: string;
  estado: EstadoRun;
  iniciada_em: string | null;
  terminada_em: string | null;
  total: number;
  concluidos: number;
  custo_usd: number | null;
}
export interface GradeRun {
  run: ResumoRun & { tarefas: Array<{ slug: string; versao: number }>; alvos: string[]; max_paralelo: number; teto_usd: number | null; juiz_alvo: string | null; pesos: PesosScore; sandbox: ModoSandbox };
  resultados: ResumoResultado[];
}
export interface DetalheResultado extends ResumoResultado {
  run_id: string;
  prompt_efetivo: string;
  tokens_in: number | null;
  tokens_total: number | null;
  turnos: number | null;
  custo_tipo: CustoTipo | null;
  checagens: ResultadoChecagem[];
  artefatos: Array<{ nome: string; tipo: string; bytes: number }>;
  isolamento: "garantido" | "parcial";
  qualidade_detalhe: Partial<Record<CriterioRubrica, number>> | null;
  notas: string | null;
  log_bytes: number;
}
export interface Pagina<T> { itens: T[]; proximo: string | null }

export type SeloComparacao = "sem_custo" | "nao_comparavel" | "harness_parcial" | "versoes_diferentes";
export interface CelulaComparacao {
  alvo: string;
  resultado_id: string | null;
  estado: EstadoResultado | null;
  qualidade: number | null;
  custo_usd: number | null;
  duracao_s: number | null;
  tokens_out: number | null;
  composite: number | null;
  vencedor: boolean;
}
export interface LinhaComparacao { tarefa: string; versao: number; atividade: string; celulas: CelulaComparacao[] }
export interface AgregadoAlvo { alvo: string; composite_medio: number | null; custo_total_usd: number | null; duracao_media_s: number | null; vitorias: number; tarefas: number }
export interface Comparacao {
  alvos: string[];
  linhas: LinhaComparacao[];
  placar: { vitorias: Record<string, number>; empates: number };
  agregado: AgregadoAlvo[];
  veredito: string;
  selos: SeloComparacao[];
}
export interface Restricoes { custo_max_usd: number | null; duracao_max_s: number | null; provedores: string[] | null }
export type Estrategia = "melhor_qualidade" | "mais_barato_aceitavel" | "mais_rapido_aceitavel";
export interface ItemRecomendacao { alvo: string; provedor: string; modelo: string; esforco: string | null; cli: string; composite: number; custo_usd: number | null; duracao_s: number | null; amostras: number; tentativas_esperadas: number; evidencia: string[] }
export interface Recomendacao { atividade: string; sem_dados: boolean; ranking: ItemRecomendacao[] }
export interface ExecutorSugerido { provider: string; cli: string | null; model: string | null; effort: string | null; faixa: null }
export interface RascunhoPolitica { atividade: string; task_type: string; executor: ExecutorSugerido; alternativas: ExecutorSugerido[]; evidencia: string[] }

export type ErroRodar = "consentimento_invalido" | "sandbox_indisponivel" | "alvo_indisponivel" | "tarefa_inativa" | "limite_execucoes";

export interface EventoProgressoBench { run_id: string; resultado_id: string | null; estado: EstadoResultado; concluidos: number; total: number; custo_acumulado_usd: number | null }
export interface EventoRunTerminouBench { run_id: string; estado: EstadoRun }
export type EventoBenchIpc = ({ tipo: "progresso" } & EventoProgressoBench) | ({ tipo: "run_terminou" } & EventoRunTerminouBench);

export interface ApiBench {
  tarefasListar(atividade: string | null, estado: EstadoTarefa | null): Promise<TarefaBench[]>;
  tarefaSalvar(tarefa: TarefaEditavel): Promise<TarefaBench | { erro: ErroTarefa }>;
  alvosListar(): Promise<AlvoDisponivel[]>;
  alvosSalvar(alvos: AlvoEditavel[]): Promise<AlvoBench[]>;
  precosLer(): Promise<PrecoBench[]>;
  precosGravar(precos: PrecoBench[]): Promise<PrecoBench[]>;
  estimar(p: { tarefas: string[]; alvos: string[]; max_paralelo: number; teto_usd: number | null; juiz_alvo: string | null }): Promise<Estimativa>;
  consentir(estimativaId: string, confirmacao: string, finalidade?: "rodar" | "rerodar" | "julgar"): Promise<{ token: string; expira_em: string } | { erro: "confirmacao_invalida" | "estimativa_desconhecida" }>;
  /** fechar o diálogo de consentimento: descarta os tokens da estimativa. */
  descartarConsentimento(estimativaId: string): Promise<boolean>;
  rodar(estimativaId: string, token: string): Promise<{ run_id: string } | { erro: ErroRodar }>;
  cancelar(runId: string): Promise<boolean>;
  rerodar(runId: string, tarefa: string, alvo: string, token: string): Promise<{ resultado_id: string } | { erro: ErroRodar }>;
  julgar(runId: string, tarefa: string | null, juizAlvo: string, token: string): Promise<{ veredito_ids: string[] } | { erro: "juiz_igual_a_executor" | "sem_resultados" | "consentimento_invalido" }>;
  notaManual(resultadoId: string, nota: number, notas: string | null): Promise<boolean>;
  runsListar(depois: string | null): Promise<Pagina<ResumoRun>>;
  estadoRun(runId: string): Promise<GradeRun>;
  resultado(resultadoId: string): Promise<DetalheResultado>;
  logLer(resultadoId: string, depois: number, max: number): Promise<{ texto: string; proximo: number }>;
  artefatoLer(resultadoId: string, nome: string): Promise<{ bytes: Uint8Array; tipo: string }>;
  comparar(alvos: string[], tarefas: string[] | null, agrupar: "tarefa" | "atividade"): Promise<Comparacao | { erro: "nao_comparavel" }>;
  recomendar(atividade: string, restricoes: Restricoes | null, estrategia: Estrategia | null): Promise<Recomendacao>;
  exportarPolitica(atividades: string[] | null): Promise<{ rascunho: RascunhoPolitica[]; avisos: string[] }>;
  exportarRelatorio(runIds: string[] | null, formato: "md" | "json"): Promise<{ caminho: string | null }>;
  assinar(cb: (e: EventoBenchIpc) => void): () => void;
}
