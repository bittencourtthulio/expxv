// Portas de repositório (a implementação SQLite — tabelas `agil_*`, ver docs/ade/pedidos/18-pedidos.md — é do coordenador).
// Contrato síncrono (node:sqlite é síncrono): `transacao` é tudo-ou-nada. Valores nunca são mutados no lugar: sempre `set` de um objeto novo.
import type {
  Classificacao, ConfigAgil, EpicoAgil, Estimativa, EventoAgil, EventoRetrabalho, FatoTask, ItemAgil, MembroAgil, SprintAgil, SprintItemAgil, TaskRetrabalho,
} from "../../compartilhado/agil";

export interface Colecao<T> {
  get(chave: string): T | undefined;
  set(chave: string, valor: T): void;
  delete(chave: string): boolean;
  valores(): T[];
}

export interface RegistroAuditoria { seq: number; acao: string; ator: "humano" | "agente" | "sistema"; workspace_id: string; alvo: string; motivo: string | null; quando: string }
export interface CerimoniaRegistro { id: string; workspace_id: string; sprint_id: string | null; tipo: "planejamento" | "daily" | "review" | "retro" | "refinamento"; data: string; formato: string | null; conteudo: unknown; gerada_de_fatos_em: string | null; editada: boolean; criado_em: string; atualizado_em: string }
export interface RetroAcao { id: string; cerimonia_id: string; texto: string; dono_membro_id: string | null; prazo: string | null; estado: "aberta" | "feita" | "cancelada"; item_id: string | null; concluida_em: string | null; criado_em: string; vencida_notificada: boolean }
export interface RetroItem { id: string; cerimonia_id: string; coluna: string; texto: string; votos: number; dado: unknown; autor_membro_id: string | null; criado_em: string }
export interface ErroEstimativaRegistro { item_id: string; estimativa_id: string; pontos_previstos: number; categoria: string | null; observado_ms: number | null; real_h: number | null; ref_ms_por_ponto: number | null; razao: number | null; registrado_em: string }
export interface SnapshotMetrica { workspace_id: string; escopo: "workspace" | "sprint" | "membro" | "squad"; chave: string; dia: string; metrica: string; valor: number | null }
export interface ResultadoDodRegistro { item_id: string; criterio: string; estado: "ok" | "falha" | "na" | "indeterminado"; fonte: "auto" | "manual"; em: string }
export interface DemoRegistro { sprint_id: string; item_id: string; resultado: "aceito" | "ajustar" | "rejeitado"; nota: string | null; em: string }

export interface BancoAgil {
  configs: Colecao<ConfigAgil>;
  itens: Colecao<ItemAgil>;
  epicos: Colecao<EpicoAgil>;
  estimativas: Colecao<Estimativa>;
  classificacoes: Colecao<Classificacao>;
  sprints: Colecao<SprintAgil>;
  /** chave `${sprint_id}|${item_id}`. */
  sprintItens: Colecao<SprintItemAgil>;
  membros: Colecao<MembroAgil>;
  /** chave `${ws}|${trabalho}|${ref}`. */
  fatos: Colecao<FatoTask>;
  /** chave `${ws}|${trabalho}` => versao_origem. */
  versoes: Colecao<string>;
  eventosRetrabalho: Colecao<EventoRetrabalho>;
  /** chave `${ws}|${trabalho}|${ref}`. */
  retrabalhoTasks: Colecao<TaskRetrabalho>;
  cerimonias: Colecao<CerimoniaRegistro>;
  retroItens: Colecao<RetroItem>;
  retroAcoes: Colecao<RetroAcao>;
  /** chave item_id. */
  erros: Colecao<ErroEstimativaRegistro>;
  snapshots: Colecao<SnapshotMetrica>;
  dodResultados: Colecao<ResultadoDodRegistro>;
  demos: Colecao<DemoRegistro>;
  /** barramento persistido (idempotência de `sprint.fechada`). */
  eventos: Colecao<EventoAgil & { seq: number }>;
  auditoria: Colecao<RegistroAuditoria>;
  /** `ws|dia` => chamadas de IA no dia (teto diário). */
  chamadasIa: Colecao<number>;
  transacao<T>(fn: () => T): T;
}

export const chaveTask = (ws: string, trabalho: string, ref: string): string => `${ws}|${trabalho}|${ref}`;
export const chaveSprintItem = (sprintId: string, itemId: string): string => `${sprintId}|${itemId}`;
