// Contrato IPC do chat orquestrador (Fase 15, onda 2): `window.ade.chat` (canais `chat:*`). Arquivo PURO (só tipos e constantes).
// O LLM nunca decide ação: o plano é montado por código e só chega aqui como DADO para exibir/aprovar. Textos já redigidos.

export type CliChat = "claude" | "codex" | "opencode" | "gemini";
export type FaixaChat = "rapido" | "medio" | "profundo";
export type ModoChat = "perguntar" | "orquestrar";
export type EstadoPlanoChat = "proposto" | "aprovado" | "executando" | "concluido" | "cancelado" | "falhou";
export type EstadoMensagemChat = "transmitindo" | "completa" | "erro" | "cancelada";
export type PapelMensagemChat = "usuario" | "assistente" | "sistema" | "progresso";

export interface PerfilChatDto {
  cli: CliChat;
  modelo: string | null;
  esforco: string | null;
  faixa: FaixaChat;
  agente_id?: string | null;
}
export interface EstadoCliChat {
  cli: CliChat;
  disponivel: boolean;
  motivo: string | null;
}
export interface PerfilChatEstado {
  perfil: PerfilChatDto | null;
  clis: EstadoCliChat[];
}

export interface CitacaoChat {
  n: number;
  documento_id: string;
  titulo: string;
  origem: string;
  tipo: string;
  ocorrido_em: string;
}

export type PassoPlanoChat =
  | { tipo: "criar_missao"; titulo: string }
  | { tipo: "abrir_pane"; titulo: string; perfil: PerfilChatDto }
  | { tipo: "disparar_metodo"; comando: string; argumento: string }
  | { tipo: "enviar_prompt"; texto: string };

export interface PlanoChatDto {
  id: string;
  conversa_id: string;
  intencao: string;
  resumo: string;
  passos: PassoPlanoChat[];
  prompt: string;
  criterios_aceite: string[];
  arquivos_provaveis: string[];
  acoes_humanas: string[];
  avisos: string[];
  mission_alvo_id: string | null;
  mission_id: string | null;
  pane_ids: string[];
  estado: EstadoPlanoChat;
  exige_aprovacao: boolean;
}

export interface ConversaChatDto {
  id: string;
  workspace_id: string;
  titulo: string;
  modo: ModoChat;
  perfil: PerfilChatDto | null;
  mission_alvo_id: string | null;
  indexar: boolean;
  criado_em: string;
  atualizado_em: string;
}
export interface MensagemChatDto {
  id: string;
  conversa_id: string;
  papel: PapelMensagemChat;
  texto: string;
  citacoes: CitacaoChat[];
  plano_id: string | null;
  estado: EstadoMensagemChat;
  criado_em: string;
}
export interface ConversaCompleta {
  conversa: ConversaChatDto;
  mensagens: MensagemChatDto[];
  planos: PlanoChatDto[];
}

export interface PedidoCriarConversa {
  workspace_id: string;
  modo: ModoChat;
  titulo: string | null;
  mission_alvo_id: string | null;
  indexar: boolean;
}
export interface PedidoGravarPerfilChat {
  workspace_id: string;
  cli: CliChat;
  modelo: string | null;
  esforco: string | null;
  faixa: FaixaChat;
  agente_id?: string | null;
}
export interface PedidoEnviarChat {
  conversa_id: string;
  texto: string;
  modo: ModoChat;
  mission_alvo_id: string | null;
}
export type DecisaoPlanoChat = "aprovar" | "cancelar" | "editar";
export interface PedidoDecidirPlano {
  plano_id: string;
  decisao: DecisaoPlanoChat;
  ajuste?: { titulo?: string; cli?: CliChat; modelo?: string | null; esforco?: string | null; prompt?: string };
}

export interface EventoChatToken {
  mensagem_id: string;
  delta: string;
}
export interface EventoChatProgresso {
  plano_id: string;
  pane_id: string | null;
  estado: string;
  resumo: string;
}

export interface PayloadsEventoChat {
  "chat:token": EventoChatToken;
  "chat:mensagem": { mensagem: MensagemChatDto };
  "chat:plano": { plano: PlanoChatDto };
  "chat:progresso": EventoChatProgresso;
}
export type CanalEventoChat = keyof PayloadsEventoChat;
export type EventoChat = { [C in CanalEventoChat]: { canal: C; payload: PayloadsEventoChat[C] } }[CanalEventoChat];
export const EVENTOS_IPC_CHAT = ["chat:token", "chat:mensagem", "chat:plano", "chat:progresso"] as const;

/** `window.ade.chat` (canais `chat:*`). */
export interface ApiChat {
  listarConversas(workspaceId: string): Promise<ConversaChatDto[]>;
  criarConversa(pedido: PedidoCriarConversa): Promise<ConversaChatDto>;
  lerConversa(conversaId: string): Promise<ConversaCompleta | null>;
  apagarConversa(conversaId: string): Promise<{ ok: boolean }>;
  lerPerfil(workspaceId: string): Promise<PerfilChatEstado>;
  gravarPerfil(pedido: PedidoGravarPerfilChat): Promise<PerfilChatEstado>;
  /** a resposta chega pelos eventos (`chat:token`, `chat:mensagem`, `chat:plano`). */
  enviar(pedido: PedidoEnviarChat): Promise<{ mensagem_id: string }>;
  parar(mensagemId: string): Promise<{ ok: boolean }>;
  decidirPlano(pedido: PedidoDecidirPlano): Promise<PlanoChatDto>;
  pararPlano(planoId: string): Promise<{ ok: boolean }>;
  assinar(cb: (e: EventoChat) => void): () => void;
}
