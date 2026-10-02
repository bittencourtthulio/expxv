// Contratos da "Voz local embutida" (Fase 11, D-540 a D-549): catálogo de modelos de fala para texto, download consentido e ciclo de vida do runtime local. Tipos puros e constantes.
// O renderer NUNCA envia caminho nem URL: o modelo é indicado só por `modelo_id` (id do catálogo versionado, conferido no main). Nenhum áudio nem transcrição aparece aqui.

/** versão do texto do consentimento de DOWNLOAD de modelo: mudar invalida os aceites antigos (o aceite vale só para o download iniciado com ela). */
export const VERSAO_CONSENTIMENTO_MODELO = "2026-10-01.1";

export type FamiliaModelo = "nemo_transducer" | "whisper" | "moonshine";
export type VelocidadeModelo = "rapida" | "media" | "lenta";
export type QualidadeModelo = "boa" | "muito_boa" | "excelente";
export type PerfilModelo = "recomendado" | "equilibrado" | "leve" | "ingles";

export type FaseModelo = "nao_instalado" | "baixando" | "pausado" | "verificando" | "autoteste" | "instalado" | "erro";

export type CodigoErroModelo =
  | "sem_internet"
  | "servidor_recusou"
  | "disco_cheio"
  | "checksum_invalido"
  | "tamanho_invalido"
  | "redirect_recusado"
  | "runtime_indisponivel"
  | "modelo_corrompido"
  | "autoteste_falhou"
  | "consentimento_ausente"
  | "sem_checksum"
  | "modelo_desconhecido"
  | "ja_baixando"
  | "nao_instalado"
  | "cancelado"
  | "indisponivel";

export const LIMITES_MODELO = {
  /** o evento de progresso sai no máximo a cada 250 ms (coalescido no main). */
  progresso_min_ms: 250,
  ociosidade_padrao_s: 120,
  ociosidade_min_s: 15,
  ociosidade_max_s: 3_600,
  /** margem de disco além do tamanho do modelo. */
  margem_disco_bytes: 64 * 1024 * 1024,
} as const;

export interface LicencaModelo {
  id: string;
  url: string;
  /** texto de atribuição (CC-BY exige creditar o autor). */
  atribuicao: string;
}

export interface ProgressoModelo {
  modelo_id: string;
  fase: FaseModelo;
  bytes: number;
  total: number;
  velocidade_bps: number;
  /** `null` até haver velocidade estável. */
  restante_s: number | null;
  arquivo_atual: string | null;
  codigo: CodigoErroModelo | null;
  /** texto simples e acionável para a pessoa (sem caminho, sem URL com parâmetros, sem segredo). */
  instrucao: string | null;
  /** monotônica por modelo: o renderer descarta o que chegar fora de ordem. */
  sequencia: number;
}

export interface ModeloVozInfo {
  id: string;
  nome: string;
  descricao: string;
  idiomas: string[];
  pt_br: boolean;
  tamanho_bytes: number;
  ram_estimada_mb: number;
  velocidade: VelocidadeModelo;
  qualidade: QualidadeModelo;
  perfil: PerfilModelo;
  recomendado: boolean;
  licenca: LicencaModelo;
  /** host que o consentimento cita (o servidor de origem). */
  host_origem: string;
  /** hosts onde os arquivos podem ser servidos depois do redirecionamento (a mesma organização). */
  hosts_arquivos: string[];
  /** `false` quando falta checksum confirmado: o app RECUSA baixar. */
  baixavel: boolean;
  motivo_nao_baixavel: string | null;
  instalado: boolean;
  bytes_em_disco: number | null;
  ativo: boolean;
  /** pasta presente mas fora do que o catálogo descreve (arquivo trocado, truncado ou marca apagada): a UI oferece apagar e baixar de novo. `null` = não instalado. */
  integridade: "ok" | "corrompido" | null;
  /** `null` se nunca foi verificado por completo. */
  verificado_em: string | null;
  /** há um download/pausa/erro em andamento para este modelo. */
  download: ProgressoModelo | null;
}

export interface ListaModelosVoz {
  modelos: ModeloVozInfo[];
  /** `null` se o SO não informou. */
  espaco_livre_bytes: number | null;
  runtime_disponivel: boolean;
  motivo_runtime: string | null;
  /** onde os modelos ficam, em texto para a pessoa saber apagar (a pasta de dados do app; nunca enviado a lugar nenhum). */
  pasta_exibicao: string;
  versao_consentimento: string;
  ociosidade_s: number;
  /** modelo carregado na memória agora. */
  carregado: boolean;
  ram_mb: number | null;
  modelo_ativo: string | null;
}

export interface ResultadoAutoteste {
  ok: boolean;
  /** palavras esperadas encontradas / total esperado. */
  acertos: number;
  esperadas: number;
  carregamento_ms: number | null;
  transcricao_ms: number | null;
  /** fator de tempo real (tempo de decodificação / duração do áudio). */
  rtf: number | null;
  codigo: CodigoErroModelo | null;
  instrucao: string | null;
}

export interface PedidoBaixarModelo {
  modelo_id: string;
  /** a versão do texto de consentimento que a pessoa viu e aceitou; precisa ser igual à vigente. */
  aceite_versao: string;
  /** depois de baixar e verificar, rodar o autoteste e tornar o motor local o ativo (padrão do botão "Baixar e ativar"). */
  ativar: boolean;
}

export interface ApiVozModelos {
  modelosListar(): Promise<ListaModelosVoz>;
  modeloBaixar(pedido: PedidoBaixarModelo): Promise<{ modelo_id: string }>;
  modeloPausar(modeloId: string): Promise<{ ok: boolean }>;
  /** retomar é um novo clique: usa o aceite já gravado para este download e continua do que já foi baixado (HTTP Range). */
  modeloRetomar(modeloId: string): Promise<{ ok: boolean }>;
  modeloCancelar(modeloId: string): Promise<{ ok: boolean }>;
  modeloApagar(modeloId: string): Promise<{ ok: boolean }>;
  modeloAtivar(modeloId: string): Promise<{ ok: boolean; codigo: CodigoErroModelo | null; instrucao: string | null }>;
  modeloAutoteste(modeloId: string): Promise<ResultadoAutoteste>;
  assinarModelos(cb: (e: ProgressoModelo) => void): () => void;
}
