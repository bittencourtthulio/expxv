// Contratos da Fase 10 (custo e board): tipos puros compartilhados entre núcleo, main e renderer. Identificadores de domínio em PT.
// REGRAS DO CONTRATO (05-CONTRATOS.md §Custo e board): custo desconhecido NUNCA vira zero (`usd: null`, `incompleto`, `aproximado`);
// nenhum tipo aqui carrega conteúdo de conversa nem caminho absoluto; o board só LÊ o método (D-04): não existe "mover" que escreva.

export interface Tokens {
  entrada: number;
  cache_escrita: number;
  cache_leitura: number;
  saida: number;
}

export const ESCOPOS_CUSTO = ["card", "missao", "trabalho", "workspace", "conta", "pane", "sprint"] as const;
export type EscopoCusto = (typeof ESCOPOS_CUSTO)[number];
/** Escopos materializados em `custo_agregado` (sprint é derivado dos cards dos itens da sprint). */
export type EscopoAgregado = Exclude<EscopoCusto, "sprint">;
export const AGRUPAR_CUSTO = ["card", "missao", "trabalho", "workspace", "conta", "modelo", "pane", "dia"] as const;
export type AgruparCusto = (typeof AGRUPAR_CUSTO)[number];

export const ATRIBUICOES = ["card", "orquestracao", "sem_card", "ambigua"] as const;
export type Atribuicao = (typeof ATRIBUICOES)[number];
export const ORIGENS_USD = ["cli", "proxy", "tabela", "desconhecido"] as const;
export type OrigemUsd = (typeof ORIGENS_USD)[number];
export const ORIGENS_PRECO = ["embutido", "usuario", "openrouter"] as const;
export type OrigemPreco = (typeof ORIGENS_PRECO)[number];
export const BASES_FONTE = ["claude_config", "codex_home", "proxy", "opencode_data"] as const;
export type BaseFonte = (typeof BASES_FONTE)[number];
export const ESTADOS_FONTE = ["lendo", "sem_fonte", "erro", "encerrada"] as const;
export type EstadoFonte = (typeof ESTADOS_FONTE)[number];

export interface CustoResumo {
  /** soma do que tem preço (limite inferior); `null` = nenhum registro tem preço (ou nenhum registro). */
  usd: number | null;
  /** há registro sem preço ou Pane sem fonte de uso ⇒ exibir "≥ US$ x". */
  incompleto: boolean;
  /** algum preço não confirmado/derivado ⇒ exibir "≈". */
  aproximado: boolean;
  tokens: Tokens;
  registros: number;
  modelos: string[];
  /** ex.: `sem_fonte:gemini` — CLI sem leitor de uso (nunca vira 0). */
  fontes_ausentes: string[];
  atualizado_em: string | null;
}

export interface CustoMissao extends CustoResumo {
  orquestracao: CustoResumo;
  cards: CustoResumo;
  sem_card: CustoResumo;
  ambiguo: CustoResumo;
}

export interface LinhaRelatorio {
  chave: string;
  rotulo: string;
  custo: CustoResumo;
}

export interface EstimativaCusto {
  mediana_usd: number | null;
  p25_usd: number | null;
  p75_usd: number | null;
  amostras: number;
  confianca: "sem_historico" | "baixa" | "media" | "alta";
}

export interface FonteDeUsoEstado {
  pane_id: string | null;
  cli: string;
  estado: EstadoFonte;
  erro_codigo: string | null;
  atraso_s: number | null;
  linhas_puladas: number;
}

export interface Preco {
  id: string;
  /** glob (`claude-opus-*`) ou id exato (`vendor/modelo`). */
  padrao: string;
  familia: string | null;
  entrada_por_mtok: number;
  saida_por_mtok: number;
  cache_escrita_por_mtok: number | null;
  cache_leitura_por_mtok: number | null;
  origem: OrigemPreco;
  confirmado: boolean;
  valido_desde: string;
  /** de onde veio o número (texto livre curto) e quando foi coletado — preço sem fonte não entra na tabela embutida. */
  fonte: string | null;
  coletado_em: string | null;
}

export interface PedidoGravarPreco {
  padrao: string;
  entrada_por_mtok: number;
  saida_por_mtok: number;
  cache_escrita_por_mtok?: number | null;
  cache_leitura_por_mtok?: number | null;
  familia?: string | null;
}

export interface ConfigCusto {
  /** câmbio MANUAL só para exibição "≈ R$"; nunca conversão automática (sem rede). */
  cambio_brl: number | null;
  alertar_preco_ausente: boolean;
  teto_padrao_missao_usd: number | null;
  ler_transcripts: boolean;
  retencao_bruta_dias: number;
  /** % do teto que dispara o AVISO prévio (evento `cost.ceiling_warning`); `null` desliga. */
  aviso_teto_pct: number | null;
}
export const CONFIG_CUSTO_PADRAO: ConfigCusto = { cambio_brl: null, alertar_preco_ausente: true, teto_padrao_missao_usd: null, ler_transcripts: true, retencao_bruta_dias: 90, aviso_teto_pct: 80 };

/** Um registro de uso JÁ EXTRAÍDO da fonte (o leitor descarta todo o resto): é só isto que atravessa o worker. */
export interface RegistroExtraido {
  chave: string;
  ts: string;
  modelo: string | null;
  tokens: Tokens;
  /** valor medido pela própria fonte (`costUSD` do transcript ou `usage.cost` do proxy). */
  usd_medido?: number | null;
}

// ------------------------------------------------------------------ previsões
export interface PrevisaoMissao {
  custo_atual_usd: number | null;
  restante_estimado_usd: number | null;
  total_projetado_usd: number | null;
  /** `historico` = cards restantes × mediana; `ritmo` = ritmo diário observado × dias; `sem_base` nunca chuta. */
  base: "historico" | "ritmo" | "sem_base";
  cards_restantes: number;
  amostras: number;
  incompleto: boolean;
}
export interface PrevisaoPeriodo {
  gasto_usd: number | null;
  media_diaria_usd: number | null;
  projecao_fim_periodo_usd: number | null;
  dias_decorridos: number;
  dias_restantes: number;
  base: "ritmo" | "sem_base";
}
export interface CustoSprint {
  sprint_id: string;
  custo: CustoResumo;
  itens: number;
  itens_sem_custo: number;
}

// ------------------------------------------------------------------ alertas e eventos de domínio (barramento; a Fase 20 consome)
export type TipoAlertaCusto = "teto_missao" | "aviso_teto_missao" | "preco_ausente" | "fonte_ausente";
export interface AlertaCusto {
  tipo: TipoAlertaCusto;
  alvo: string;
  mensagem: string;
  mission_id?: string;
  usd?: number;
  teto_usd?: number;
}
export interface EventosDominioCusto {
  "cost.updated": { escopos: Array<{ escopo: EscopoAgregado; chave: string }> };
  "cost.ceiling_reached": { mission_id: string; usd: number; teto_usd: number };
  "cost.ceiling_warning": { mission_id: string; usd: number; teto_usd: number; pct: number };
  "cost.price_missing": { modelo: string };
  "usage.source_missing": { pane_id: string; cli: string };
  "board.changed": { versao: number };
}
export type TipoEventoDominioCusto = keyof EventosDominioCusto;

// ------------------------------------------------------------------ board
export const COLUNAS_BOARD = ["backlog", "a_fazer", "em_andamento", "em_revisao", "concluido", "validado"] as const;
export type ColunaBoard = (typeof COLUNAS_BOARD)[number];
export const SELOS_CARD = ["pronta", "bloqueada", "violacao", "descartada", "delegada"] as const;
export type SeloCard = (typeof SELOS_CARD)[number];
export type SuiteCard = "verde" | "vermelha" | "parcial" | "nao_executada";
export type StatusHandoff = "ok" | "parcial" | "bloqueado" | "falhou";

export interface CustoLeve {
  usd: number | null;
  incompleto: boolean;
  aproximado: boolean;
}
export interface CardBoard {
  /** `<workspace_id>|<trabalho_id>|<task_id>` */
  chave: string;
  task_id: string;
  trabalho_id: string;
  trabalho_titulo: string;
  workspace_id: string;
  fase: string | null;
  titulo: string;
  coluna: ColunaBoard;
  selos: SeloCard[];
  depende_de: string[];
  suite: SuiteCard;
  mission_id: string | null;
  executor: { pane_id: string; cli: string; modelo: string | null; conta_rotulo: string | null } | null;
  handoff_status: StatusHandoff | null;
  duracao_observada_ms: number | null;
  custo: CustoLeve;
}
export interface ProgressoBoard {
  total: number;
  descartado: number;
  concluido: number;
  validado: number;
  pct_concluido: number;
  pct_validado: number;
}
export interface InfoWip {
  total: number;
  limite: number | null;
  excedido: boolean;
}
export interface TrabalhoDoBoard {
  trabalho_id: string;
  titulo: string;
  mission_id: string | null;
  progresso: ProgressoBoard;
  custo: CustoResumo;
}
export interface BoardModelo {
  versao: number;
  gerado_em: string;
  colunas: Record<ColunaBoard, CardBoard[]>;
  progresso: ProgressoBoard;
  trabalhos: TrabalhoDoBoard[];
  custo: CustoResumo;
  /** limite de trabalho em andamento por coluna (WIP); `limite: null` = sem limite. Só informa: o ADE nunca bloqueia (P-80). */
  wip: Record<ColunaBoard, InfoWip>;
  /** cards `descartada` (só no filtro "descartados"; o custo deles já está em `custo`). */
  descartados: CardBoard[];
}
export type OrdenacaoBoard = "plano" | "custo" | "recente";
export interface FiltrosBoard {
  workspace_id: string | null;
  trabalho_ids?: string[];
  mission_id?: string;
  colunas?: ColunaBoard[];
  selos?: SeloCard[];
  modelo?: string;
  com_custo?: boolean;
  busca?: string;
  agrupar?: "nenhum" | "trabalho" | "fase";
  ordenar?: OrdenacaoBoard;
  mostrar_descartados?: boolean;
}
export interface ConfigBoard {
  /** limite de cards por coluna (só `em_andamento`/`em_revisao` fazem sentido; as demais são aceitas e ignoradas na UI). */
  wip: Partial<Record<ColunaBoard, number | null>>;
  /** P-80 (opt-in por workspace; padrão `false` = só alerta): com o teto da Missão estourado, NÃO inicia novo card delegado. Nada em andamento é interrompido. */
  bloquear_ao_estourar_teto?: boolean;
}
export const CONFIG_BOARD_PADRAO: ConfigBoard = { wip: {} };

export type AcaoMovimento = "copiar_comando" | "delegar" | "abrir_pane" | "humano" | "nenhuma";
/** Regra de movimento DERIVADA do método: o ADE nunca move card nem grava no método (D-04/D-107). */
export interface MovimentoCard {
  para: ColunaBoard;
  permitido: boolean;
  /** quem executa de fato: o método (comando digitado), o worker delegado ou um humano (validação/merge, D-21). */
  acao: AcaoMovimento;
  motivo: string;
  comando: string | null;
  grava_no_metodo: false;
}

export interface CardDetalhe {
  card: CardBoard;
  contrato: { objetivo: string | null; criterio_aceite: string | null; teste_integracao: string | null; teste_funcional: string | null; teste_regressao: string | null };
  janela: { inicio: string; fim: string | null; origem: "banco" | "rastro" } | null;
  violacoes: string[];
  custo: CustoResumo;
  custo_por_modelo: Array<{ modelo: string | null; tokens: Tokens; usd: number | null; origem: OrigemUsd; aproximado: boolean }>;
  panes: Array<{ pane_id: string; cli: string; modelo: string | null; conta_rotulo: string | null; papel: string }>;
  handoffs: Array<{ id: string; status: string; resumo: string; criado_em: string }>;
  rastro: Array<{ ts: string; evento: string; detalhe: string }>;
  /** relativo ao worktree; só para `board:abrir_arquivo` (o renderer nunca recebe caminho absoluto). */
  arquivo_task: string | null;
  movimentos: MovimentoCard[];
}

// ------------------------------------------------------------------ pedidos e respostas de IPC
export interface PedidoResumoCusto {
  escopo: EscopoCusto;
  chave: string;
}
export interface FiltrosRelatorioCusto {
  workspace_id?: string;
  mission_id?: string;
  trabalho_id?: string;
  conta_id?: string;
  modelo?: string;
}
export interface PedidoRelatorioCusto {
  agrupar: AgruparCusto;
  desde: string;
  ate: string;
  filtros?: FiltrosRelatorioCusto;
  cursor?: string | null;
  limite?: number;
}
export interface RespostaRelatorioCusto {
  linhas: LinhaRelatorio[];
  total: CustoResumo;
  proximo: string | null;
}
export interface PedidoEstimativaCusto {
  /** workspace das amostras (cards concluídos e completos); sem ele não há histórico. */
  workspace_id?: string;
  /** reservado: o método não grava `task_type` por card; hoje a amostra é o workspace (ou o `trabalho_id`, quando dado). */
  task_type?: string;
  trabalho_id?: string;
  task_id?: string;
}
export interface EventoCusto {
  tipo: "atualizado" | "teto" | "aviso_teto" | "fonte_ausente" | "preco_ausente";
  escopos?: Array<{ escopo: EscopoAgregado; chave: string }>;
  mission_id?: string;
  usd?: number;
  teto_usd?: number;
  pane_id?: string;
  cli?: string;
  modelo?: string;
}
export interface EventoBoard {
  versao: number;
}
export interface PedidoDetalheCard {
  workspace_id: string;
  trabalho_id: string;
  task_id: string;
}
export interface PedidoDelegarCard extends PedidoDetalheCard {
  mission_id: string;
  confirmar: true;
}
export interface RespostaDelegarCard {
  pane_id: string;
  task_ref: string;
  recibo: string;
  /** estimativa histórica do trabalho (mediana de cards concluídos e completos; `sem_historico` com < 3 amostras). NUNCA é o custo do card. */
  estimativa?: EstimativaCusto;
}
