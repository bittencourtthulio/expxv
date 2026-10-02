// Tipos do chat orquestrador (T-15.31..34). O chat é uma MÁQUINA DE ESTADOS com PORTAS: o LLM nunca decide ação; o plano é montado por
// código determinístico e executado por uma porta de orquestração (as tools do piloto). Nada aqui toca Electron, rede ou terminal.
export type CliChat = "claude" | "codex" | "opencode" | "gemini";
export type FaixaChat = "rapido" | "medio" | "profundo";
export type ModoChat = "perguntar" | "orquestrar";
/** P-52: confirmar sempre · direto só para ação reversível (padrão) · direto total (opt-in; destrutivo SEMPRE confirma). */
export type ModoExecucaoChat = "confirmar" | "reversiveis" | "total";

export interface PerfilChat {
  cli: CliChat;
  modelo: string | null;
  esforco: string | null;
  faixa: FaixaChat;
  agente_id?: string | null;
}

export interface Citacao {
  /** número [n] usado no texto da resposta. */
  n: number;
  documento_id: string;
  titulo: string;
  origem: string;
  tipo: string;
  ocorrido_em: string;
}

export type PassoPlano =
  | { tipo: "criar_missao"; titulo: string }
  | { tipo: "abrir_pane"; titulo: string; perfil: PerfilChat }
  | { tipo: "disparar_metodo"; comando: string; argumento: string }
  | { tipo: "enviar_prompt"; texto: string };

export type EstadoPlano = "proposto" | "aprovado" | "executando" | "concluido" | "cancelado" | "falhou";

export interface PlanoChat {
  id: string;
  intencao: string;
  resumo: string;
  passos: PassoPlano[];
  /** prompt melhorado COMPLETO (com o envelope de dados do RAG). */
  prompt: string;
  criterios_aceite: string[];
  arquivos_provaveis: string[];
  /** ações que o chat NUNCA faz (D-21): ficam para o humano. */
  acoes_humanas: string[];
  avisos: string[];
  mission_alvo_id: string | null;
  mission_id: string | null;
  pane_ids: string[];
  estado: EstadoPlano;
  rag_consulta_id: string | null;
  /** o plano exige aprovação humana antes de executar. */
  exige_aprovacao: boolean;
}

/** Porta das tools de orquestração do piloto. */
export interface PortaOrquestracao {
  criarMissao(p: { titulo: string }): Promise<{ mission_id: string }>;
  abrirPane(p: { mission_id: string; titulo: string; perfil: PerfilChat }): Promise<{ pane_id: string }>;
  /** digita `/expx:<comando> <argumento>` no terminal (D-20). */
  dispararMetodo(p: { pane_id: string; comando: string; argumento: string; /** prompt melhorado COMPLETO (vai por arquivo do trabalho; nunca no argv) */ prompt?: string }): Promise<void>;
  enviarPrompt(p: { pane_id: string; texto: string }): Promise<void>;
  parar?(p: { pane_ids: string[] }): Promise<void>;
}

/** Porta do LLM/CLI do chat (via harness; assinatura do usuário, nunca chave própria). */
export interface PortaLlm {
  disponivel(): Promise<{ ok: boolean; motivo?: string }>;
  executar(p: { sistema: string; prompt: string; sinal: AbortSignal }): AsyncIterable<string>;
}
