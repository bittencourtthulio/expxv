// Contrato IPC do conhecimento (Fase 15, onda 2): pedidos, respostas, eventos e `ApiConhecimento` (`window.ade.conhecimento`).
// Arquivo PURO (só tipos e constantes; o preload não importa runtime). Nenhum campo carrega caminho absoluto, segredo nem texto não
// redigido. A identidade de agente (token) nunca passa por aqui: estes canais são AÇÃO HUMANA.
import type {
  Aprendizado,
  ArestaGrafo,
  EscopoBusca,
  EstadoAprendizado,
  EstadoConhecimento,
  EstadoConsulta,
  FonteResultado,
  ModoBusca,
  NoGrafo,
  OrigemConsulta,
  RespostaBusca,
  RespostaContexto,
  TipoAprendizado,
  TipoDocumento,
  ValorFeedback,
} from "./conhecimento";

export type Pagina<T> = { itens: T[]; proximo: string | null };

export type ConsultaObrigatoria = "off" | "aviso" | "bloqueio";
export type AprendizadoModo = "deterministico" | "assistido";
export type ChatExecucao = "confirmar" | "reversiveis" | "total";

export interface ConfigConhecimentoDto {
  workspace_id: string;
  ativo: boolean;
  consulta_obrigatoria: ConsultaObrigatoria;
  contexto_chars: number;
  hook_prompt: boolean;
  indexar_codigo: boolean;
  indexar_transcricoes: boolean;
  aprendizado_modo: AprendizadoModo;
  retencao_transcricao_dias: number;
  chat_execucao: ChatExecucao;
}
export type PedidoGravarConfigConhecimento = { workspace_id: string } & Partial<Omit<ConfigConhecimentoDto, "workspace_id">>;

export interface PedidoBuscarConhecimento {
  workspace_id: string;
  consulta: string;
  modo: ModoBusca;
  tipos: TipoDocumento[] | null;
  desde: string | null;
  limite: number;
  escopo: EscopoBusca;
}
export interface PedidoContextoPrevia {
  workspace_id: string;
  tarefa: string;
  arquivos: string[];
  orcamento_chars: number;
}
export interface PedidoListarDocumentos {
  workspace_id: string;
  tipo: TipoDocumento | null;
  mission_id: string | null;
  busca: string | null;
  depois: string | null;
  limite: number;
}
export interface DetalheDocumento {
  fonte: FonteResultado;
  chunks: Array<{ id: string; trecho: string }>;
  aprendizado: Aprendizado | null;
  arestas: ArestaGrafo[];
}

export type FonteReindexar = "docs" | "codigo" | "git" | "transcricoes" | "tudo";
export type AlvoEsquecer =
  | { documento_id: string }
  | { origem: string }
  | { mission_id: string }
  | { pane_id: string }
  | { tipo: TipoDocumento }
  | { antes_de: string };

export interface PedidoSubgrafo {
  workspace_id: string;
  tipos: string[] | null;
  desde: string | null;
  mission_id: string | null;
  foco_no_id: string | null;
  max_nos: number;
}
export interface RespostaSubgrafo {
  nos: NoGrafo[];
  arestas: ArestaGrafo[];
  truncado: boolean;
}
export interface DetalheNoGrafo {
  no: NoGrafo;
  vizinhos: NoGrafo[];
  fontes: FonteResultado[];
  aprendizados: Array<{ id: string; titulo: string; tipo: TipoAprendizado; estado: EstadoAprendizado }>;
}
export interface PosicaoNo {
  id: string;
  x: number;
  y: number;
}

export interface PedidoListarAprendizados {
  workspace_id: string;
  estado: EstadoAprendizado | null;
  tipo: TipoAprendizado | null;
  busca: string | null;
  depois: string | null;
  limite: number;
}
export type AcaoAprendizado = "ativar" | "arquivar" | "rejeitar" | "editar";
export interface PedidoAtualizarAprendizado {
  workspace_id: string;
  id: string;
  acao: AcaoAprendizado;
  texto?: string;
}
export interface PedidoFeedbackConhecimento {
  workspace_id: string;
  alvo_tipo: "chunk" | "documento" | "aprendizado";
  alvo_id: string;
  valor: ValorFeedback;
  nota?: string;
}

/** Estado de um modelo de embedding detectável (detecção do Ollama é só loopback; nada é baixado sem botão). */
export interface ModeloEmbeddingDto {
  id: string;
  rotulo: string;
  dimensao: number;
  origem: "hash" | "ollama" | "onnx";
  disponivel: boolean;
  motivo: string | null;
}
export interface EstadoModelosEmbedding {
  ativo: string;
  modelos: ModeloEmbeddingDto[];
  /** `null` = Ollama não detectado. */
  ollama_url: string | null;
}

export interface EventoConhecimentoProgresso {
  workspace_id: string;
  fase: string | null;
  pendentes: number;
  pct: number | null;
}
export interface EventoConhecimentoConsultado {
  workspace_id: string;
  consulta_id: string;
  origem: OrigemConsulta;
  estado: EstadoConsulta;
  n: number;
  latencia_ms: number;
}
export interface EventoAprendizadoNovo {
  workspace_id: string;
  id: string;
  tipo: TipoAprendizado;
}

export interface PayloadsEventoConhecimento {
  "conhecimento:progresso": EventoConhecimentoProgresso;
  "conhecimento:consultado": EventoConhecimentoConsultado;
  "conhecimento:aprendizado_novo": EventoAprendizadoNovo;
}
export type CanalEventoConhecimento = keyof PayloadsEventoConhecimento;
export type EventoConhecimentoApi = { [C in CanalEventoConhecimento]: { canal: C; payload: PayloadsEventoConhecimento[C] } }[CanalEventoConhecimento];
export const EVENTOS_IPC_CONHECIMENTO = ["conhecimento:progresso", "conhecimento:consultado", "conhecimento:aprendizado_novo"] as const;

/** `window.ade.conhecimento` (canais `conhecimento:*`). */
export interface ApiConhecimento {
  estado(workspaceId: string): Promise<EstadoConhecimento>;
  lerConfig(workspaceId: string): Promise<ConfigConhecimentoDto>;
  gravarConfig(pedido: PedidoGravarConfigConhecimento): Promise<ConfigConhecimentoDto>;
  buscar(pedido: PedidoBuscarConhecimento): Promise<RespostaBusca>;
  contextoPrevia(pedido: PedidoContextoPrevia): Promise<RespostaContexto>;
  listarDocumentos(pedido: PedidoListarDocumentos): Promise<Pagina<FonteResultado>>;
  detalheDocumento(workspaceId: string, documentoId: string): Promise<DetalheDocumento | null>;
  reindexar(workspaceId: string, fonte: FonteReindexar): Promise<{ enfileirado: boolean }>;
  esquecer(workspaceId: string, alvo: AlvoEsquecer): Promise<{ removidos: number }>;
  /** `confirmacao` = nome do workspace digitado. */
  purgar(workspaceId: string, confirmacao: string): Promise<{ removidos: number }>;
  importarHistorico(workspaceId: string, cli: "claude" | "codex" | "opencode"): Promise<{ enfileirado: boolean; sessoes: number }>;
  /** o main abre o diálogo de salvar; `null` = cancelou. */
  exportar(workspaceId: string): Promise<{ caminho_salvo: string | null }>;
  subgrafo(pedido: PedidoSubgrafo): Promise<RespostaSubgrafo>;
  detalheNo(workspaceId: string, noId: string): Promise<DetalheNoGrafo | null>;
  gravarPosicoes(workspaceId: string, posicoes: PosicaoNo[]): Promise<{ ok: boolean }>;
  listarAprendizados(pedido: PedidoListarAprendizados): Promise<Pagina<Aprendizado>>;
  atualizarAprendizado(pedido: PedidoAtualizarAprendizado): Promise<Aprendizado | null>;
  feedback(pedido: PedidoFeedbackConhecimento): Promise<{ ok: boolean }>;
  destilarMissao(workspaceId: string, missionId: string): Promise<{ aprendizados: number }>;
  modelos(workspaceId: string): Promise<EstadoModelosEmbedding>;
  /** `modelo` = id de `ModeloEmbeddingDto`; reembute em segundo plano. */
  definirModelo(workspaceId: string, modelo: string): Promise<EstadoModelosEmbedding>;
  assinar(cb: (e: EventoConhecimentoApi) => void): () => void;
}
