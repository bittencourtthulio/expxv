// Contratos do decisor local laya (Fase 25, D-695 a D-708): download consentido de pesos de decisão tipada,
// ciclo de vida do runtime local e métricas. Tipos puros e constantes — nada de runtime aqui.
// O renderer NUNCA envia caminho nem URL: o modelo é indicado só por `modelo_id` (id do catálogo versionado,
// conferido no main). Nenhum texto de entrada/saída do decisor aparece em contrato algum: só decisão tipada e métricas (D-699).

/** versão do texto do consentimento de DOWNLOAD de modelo: mudar invalida os aceites antigos. */
export const VERSAO_CONSENTIMENTO_MODELO_LAYA = "2026-10-02.1";

export const TIPOS_PERGUNTA = ["choice", "score", "noul"] as const;
export type TipoPergunta = (typeof TIPOS_PERGUNTA)[number];

/** estados do SERVIÇO do decisor (não do download): D-707 — `falhou` fica assim até a pessoa clicar de novo. */
export const ESTADOS_LAYA = ["indisponivel", "desligado", "pronto", "carregando", "ativo", "falhou"] as const;
export type EstadoLaya = (typeof ESTADOS_LAYA)[number];

export type FaseModeloLaya = "nao_instalado" | "baixando" | "pausado" | "verificando" | "instalado" | "erro";

export type CodigoErroLaya =
  | "sem_internet"
  | "servidor_recusou"
  | "disco_cheio"
  | "checksum_invalido"
  | "tamanho_invalido"
  | "redirect_recusado"
  | "runtime_indisponivel"
  | "modelo_corrompido"
  | "consentimento_ausente"
  | "sem_checksum"
  | "modelo_desconhecido"
  | "ja_baixando"
  | "nao_instalado"
  | "cancelado"
  | "indisponivel";

/** Decisão tipada: a ÚNICA coisa que o laya devolve aos consumidores (G1/D-698). Nunca contém texto da entrada. */
export interface DecisaoLaya {
  tipo: TipoPergunta;
  /** `choice`: id da opção vencedora. */
  escolha: string | null;
  /** `score`: média da escala ordinal. */
  pontuacao: number | null;
  /** `noul`: probabilidade de "sim"; `choice`: probabilidade da escolha. */
  probabilidade: number | null;
  /** distribuição por rótulo/nível quando o tipo pede (soma 1). */
  distribuicao: Record<string, number> | null;
  confianca: number;
  /** limiar vigente no momento (a abstenção é `confianca < limiar`). */
  limiar: number;
  latencia_ms: number;
  modelo_id: string;
  /** `true` = o decisor se absteve (o consumidor segue no fallback determinístico). */
  absteve: boolean;
}

export interface ConfigLaya {
  /** liga o serviço do decisor (só vale com modelo pronto; desligar = encerrar o processo, D-708). */
  habilitado: boolean;
  modelo_id: string | null;
  confianca_minima: number;
  taxa_maxima_minuto: number;
  ociosidade_s: number;
  /** consumidores (D-701): todos nascem desligados. */
  usar_no_maestro: boolean;
  ordenar_roteamento: boolean;
  sinais_terminal: boolean;
  classificar_erros: boolean;
  urgencia_alertas: boolean;
}

export const CONFIG_LAYA_PADRAO: ConfigLaya = {
  habilitado: false,
  modelo_id: null,
  confianca_minima: 0.6,
  taxa_maxima_minuto: 60,
  ociosidade_s: 120,
  usar_no_maestro: false,
  ordenar_roteamento: false,
  sinais_terminal: false,
  classificar_erros: false,
  urgencia_alertas: false,
};

export const LIMITES_LAYA = {
  /** toda decisão tem timeout ≤ 500 ms; o consumidor NUNCA bloqueia (D-700, AP-18). */
  timeout_ms: 500,
  taxa_padrao_minuto: 60,
  /** teto da entrada por chamada: trunca mantendo o fim e conta o descarte (D-699, AP-01). */
  teto_entrada_bytes: 8192,
  /** progresso do download coalescido (P-706). */
  progresso_min_ms: 250,
  /** crash: UMA retentativa; segunda queda = desligado até clique (D-707, AP-06). */
  retentativas_crash: 1,
  ociosidade_padrao_s: 120,
  ociosidade_min_s: 15,
  ociosidade_max_s: 3_600,
  margem_disco_bytes: 64 * 1024 * 1024,
} as const;

export interface LicencaModeloLaya {
  id: string;
  url: string;
  atribuicao: string;
}

export interface ProgressoModeloLaya {
  modelo_id: string;
  fase: FaseModeloLaya;
  bytes: number;
  total: number;
  velocidade_bps: number;
  restante_s: number | null;
  arquivo_atual: string | null;
  codigo: CodigoErroLaya | null;
  instrucao: string | null;
  /** monotônica por modelo: o renderer descarta o que chegar fora de ordem. */
  sequencia: number;
}

export interface ModeloLayaInfo {
  id: string;
  nome: string;
  descricao: string;
  idiomas: string[];
  pt_br: boolean;
  tamanho_bytes: number;
  ram_estimada_mb: number;
  /** contexto máximo do checkpoint (teto de tokens da entrada, D-699). */
  contexto_max_tokens: number;
  /** tipos de pergunta que o checkpoint suporta. */
  tipos_pergunta: TipoPergunta[];
  licenca: LicencaModeloLaya;
  host_origem: string;
  hosts_arquivos: string[];
  /** `false` quando falta checksum confirmado: o app RECUSA baixar (D-697, AP-14). */
  baixavel: boolean;
  motivo_nao_baixavel: string | null;
  instalado: boolean;
  bytes_em_disco: number | null;
  ativo: boolean;
  integridade: "ok" | "corrompido" | null;
  verificado_em: string | null;
  download: ProgressoModeloLaya | null;
}

export interface ListaModelosLaya {
  modelos: ModeloLayaInfo[];
  espaco_livre_bytes: number | null;
  runtime_disponivel: boolean;
  motivo_runtime: string | null;
  pasta_exibicao: string;
  versao_consentimento: string;
  ociosidade_s: number;
  carregado: boolean;
  ram_mb: number | null;
  modelo_ativo: string | null;
}

export interface PedidoBaixarModeloLaya {
  modelo_id: string;
  aceite_versao: string;
  ativar: boolean;
}

/** métricas AGREGADAS por consumidor: contadores de decisão/abstenção/erro — nunca texto (D-699, AP-09). */
export interface MetricasConsumidorLaya {
  decisoes: number;
  abstencoes: number;
  erros: number;
  /** pedidos descartados por taxa/coalescência (P-709). */
  descartes: number;
}

export interface EstadoServicoLaya {
  estado: EstadoLaya;
  config: ConfigLaya;
  modelo_ativo: string | null;
  carregado: boolean;
  ram_mb: number | null;
  /** latências da janela recente (fila vazia); `null` = sem medida (D-704: nunca inventado). */
  latencia_p50_ms: number | null;
  latencia_p95_ms: number | null;
  metricas: Record<string, MetricasConsumidorLaya>;
  codigo: CodigoErroLaya | null;
  instrucao: string | null;
}

export interface ResultadoTesteLaya {
  ok: boolean;
  carga_ms: number | null;
  latencia_p50_ms: number | null;
  latencia_p95_ms: number | null;
  ram_mb: number | null;
  /** decisão de amostra (tipada) — prova o contrato choice/score/noul sem texto. */
  decisao_amostra: DecisaoLaya | null;
  codigo: CodigoErroLaya | null;
  instrucao: string | null;
}

export interface ApiLaya {
  estado(): Promise<EstadoServicoLaya>;
  consentir(host: string, aceitar: boolean): Promise<{ ok: true }>;
  modelosListar(): Promise<ListaModelosLaya>;
  modeloBaixar(pedido: PedidoBaixarModeloLaya): Promise<{ modelo_id: string }>;
  modeloPausar(modeloId: string): Promise<{ ok: boolean }>;
  modeloRetomar(modeloId: string): Promise<{ ok: boolean }>;
  modeloCancelar(modeloId: string): Promise<{ ok: boolean }>;
  modeloApagar(modeloId: string): Promise<{ ok: boolean }>;
  modeloAtivar(modeloId: string): Promise<{ ok: boolean; codigo: CodigoErroLaya | null; instrucao: string | null }>;
  testar(): Promise<ResultadoTesteLaya>;
  configGravar(patch: Partial<ConfigLaya>): Promise<EstadoServicoLaya>;
  assinarModelos(cb: (e: ProgressoModeloLaya) => void): () => void;
  assinarEstado(cb: (e: EstadoServicoLaya) => void): () => void;
}

export const CANAIS_INVOKE_LAYA: readonly string[] = [
  "laya:estado",
  "laya:consentir",
  "laya:modelos_listar",
  "laya:modelo_baixar",
  "laya:modelo_pausar",
  "laya:modelo_retomar",
  "laya:modelo_cancelar",
  "laya:modelo_apagar",
  "laya:modelo_ativar",
  "laya:testar",
  "laya:config_gravar",
];

export const CANAIS_EVENTO_LAYA: readonly string[] = ["laya:modelo_progresso", "laya:estado_mudou"];
