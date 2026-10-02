// Contrato IPC do backend online opcional do RAG (Fase 15, D-90..D-92): `window.ade.rag` (canais `rag:*`). Arquivo PURO.
// Segredo entra UMA vez (campos_secretos) e NUNCA volta: a resposta só tem máscaras. Nada sai da máquina sem consentimento.
import type { ConsentimentoBackend, EstadoMigracao, ModoBackend, TipoDocumento } from "./conhecimento";

export type ProvedorRag = "qdrant" | "supabase" | "upstash" | "pinecone";

export interface CampoProvedor {
  chave: string;
  rotulo: string;
  secreto: boolean;
  obrigatorio: boolean;
  dica: string | null;
}
export interface ProvedorRagDto {
  id: ProvedorRag;
  nome: string;
  campos: CampoProvedor[];
  capacidades: { hibrido: boolean; filtroNativo: boolean; dimensaoMaxima: number | null; loteMaximo: number; consistenciaEventual: boolean };
  /** script de preparação copiável (Supabase); `null` nos demais. */
  script_preparacao: string | null;
}

export interface EstadoBackendRag {
  provedor: ProvedorRag | null;
  url: string | null;
  host: string | null;
  colecao_remota: string | null;
  modo: ModoBackend;
  tipos: TipoDocumento[];
  equipe_id: string | null;
  autor: string | null;
  projeto_id: string | null;
  /** campo → máscara (`••••1234` ou "configurada"); nunca o valor. */
  segredos: Record<string, string>;
  consentimento: ConsentimentoBackend | null;
  offline: boolean;
  ultima_sincronizacao: string | null;
  pendentes_envio: number;
  migracao_ativa: { migracao_id: string; estado: EstadoMigracao; enviados: number; total: number } | null;
}

export interface PedidoConfigurarBackend {
  workspace_id: string;
  provedor: ProvedorRag;
  url: string;
  colecao_remota: string;
  campos_secretos: Record<string, string>;
  modo: ModoBackend;
  tipos: TipoDocumento[];
  equipe_id?: string;
  autor?: string;
}
export type PedidoTestarBackend = PedidoConfigurarBackend | { workspace_id: string; usar_salvo: true };
export interface ResultadoTestarBackend {
  ok: boolean;
  versao?: string;
  motivo?: string;
  dimensao_remota?: number;
  modelo_remoto?: string;
}

export interface PreviaMigracao {
  previa_id: string;
  por_tipo: Record<string, { itens: number; bytes: number }>;
  total: number;
  amostra: Array<{ tipo: string; origem: string; trecho: string }>;
  avisos: string[];
  estimativa_reembutir: number | null;
  destino: { provedor: string; host: string; colecao: string; versao_politica: number };
}
export interface ResultadoVerificacaoMigracao {
  ok: boolean;
  local: number;
  remoto: number;
  amostrados: number;
  divergentes: number;
}

export interface EventoMigracaoProgresso {
  migracao_id: string;
  estado: EstadoMigracao;
  enviados: number;
  total: number;
}
export interface EventoRagAviso {
  codigo: "offline" | "modelo_divergente" | "cota" | "chave_expirada";
  mensagem: string;
}
export interface PayloadsEventoRag {
  "rag:migracao_progresso": EventoMigracaoProgresso;
  "rag:aviso": EventoRagAviso;
}
export type CanalEventoRag = keyof PayloadsEventoRag;
export type EventoRag = { [C in CanalEventoRag]: { canal: C; payload: PayloadsEventoRag[C] } }[CanalEventoRag];
export const EVENTOS_IPC_RAG = ["rag:migracao_progresso", "rag:aviso"] as const;

/** `window.ade.rag` (canais `rag:*`). */
export interface ApiRag {
  estado(workspaceId: string): Promise<EstadoBackendRag>;
  provedores(): Promise<ProvedorRagDto[]>;
  configurar(pedido: PedidoConfigurarBackend): Promise<{ ok: boolean; mascarado: Record<string, string> }>;
  testar(pedido: PedidoTestarBackend): Promise<ResultadoTestarBackend>;
  esquecerSegredo(provedor: ProvedorRag): Promise<{ ok: boolean }>;
  previaMigracao(workspaceId: string, tipos: TipoDocumento[]): Promise<PreviaMigracao>;
  iniciarMigracao(pedido: { workspace_id: string; previa_id: string; consentimento: { provedor: string; host: string; colecao: string; versao_politica: number } }): Promise<{ migracao_id: string }>;
  pausarMigracao(migracaoId: string): Promise<{ ok: boolean }>;
  retomarMigracao(migracaoId: string): Promise<{ ok: boolean }>;
  cancelarMigracao(migracaoId: string): Promise<{ ok: boolean }>;
  verificarMigracao(migracaoId: string): Promise<ResultadoVerificacaoMigracao>;
  voltarParaLocal(workspaceId: string, baixarDoRemoto: boolean): Promise<{ ok: boolean }>;
  sincronizar(workspaceId: string): Promise<{ enviados: number; recebidos: number }>;
  /** `confirmacao` = nome da coleção remota digitado. */
  apagarRemoto(workspaceId: string, confirmacao: string): Promise<{ apagados: number | "desconhecido" }>;
  assinar(cb: (e: EventoRag) => void): () => void;
}
