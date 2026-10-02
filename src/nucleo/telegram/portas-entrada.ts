// Portas da ENTRADA remota (T-20.28): o núcleo nunca fala com serviços reais; o main injeta adaptadores sobre Fases 14/15/16
// (orquestrador + Maestro + squads), rigidez (F16), Missões/consumo/tarefas (consultas). Falha ou ausência da porta => falha SEGURA (desktop).
import type { PlanoRemoto } from "../../compartilhado/alertas";

export type MotivoRecusa = "orquestrador_indisponivel" | "intencao_nao_suportada" | "workspace_invalido" | "bloqueado";
export type EstadoPlanoRemoto = "proposto" | "executando" | "concluido" | "falhou" | "cancelado" | "desconhecido";

export interface PortaOrquestrador {
  /** classifica por REGRAS (a LLM nunca decide ação), monta o plano por código e devolve; `texto_redigido` é DADO não confiável. */
  proporPlano(p: { workspace_id: string; texto_redigido: string; origem: "telegram"; usuario_ref: string; ajuste?: string; plano_anterior_id?: string }): Promise<PlanoRemoto | { recusado: MotivoRecusa }>;
  /** o plano ATUAL (pode ter mudado desde a proposta: rigidez, branch…). */
  planoAtual(plano_id: string): Promise<PlanoRemoto | null>;
  /** reavalia `args_hash`; nunca assume modo direto. */
  executarPlano(plano_id: string, aprovacao: { aprovado_por: string; args_hash: string }): Promise<{ iniciado: boolean; mission_id?: string; motivo?: string }>;
  /** para; NUNCA apaga Pane/worktree. */
  pararPlano(plano_id: string): Promise<boolean>;
  estadoPlano(plano_id: string): EstadoPlanoRemoto;
}
export interface PortaRigidez {
  exigeDesktop(p: { workspace_id: string; mission_id?: string; plano: PlanoRemoto }): { exige: boolean; motivo: string };
}

export interface LinhaTarefaConsulta {
  task_id: string;
  titulo: string;
  story_points: number | null;
  tempo_trabalho_ms: number | null;
  tokens: number | null;
  atraso_ms?: number | null;
  limite_ms?: number | null;
  quem?: string | null;
}
export interface PortaConsulta {
  missoesAtivas(workspaces: string[]): Promise<Array<{ id: string; titulo: string; workspace_id: string; panes_trabalhando: number; panes_aguardando: number }>>;
  tarefasEmAndamento(workspaces: string[], limite: number): Promise<LinhaTarefaConsulta[]>;
  proximasTarefas?(workspaces: string[], limite: number): Promise<LinhaTarefaConsulta[]>;
  atrasadas(workspaces: string[]): Promise<LinhaTarefaConsulta[]>;
  cotaGeralPct(): number | null;
  consumo?(): Promise<Array<{ conta: string; provedor: string; pct: number | null }>>;
  alertasCriticosNaoLidos(): number;
  nomeWorkspace(workspace_id: string): string | null;
}

export interface GatePendente {
  id: string;
  titulo: string;
  workspace_id: string;
  /** aprovação de raio ALTO, assinatura do prodx, merge, mergex-revisar: SÓ no desktop (D-21). */
  exige_humano: boolean;
}
export interface PortaGates {
  pendentes(workspaces: string[]): Promise<GatePendente[]>;
  decidir(id: string, decisao: "aprovar" | "recusar", origem: string): Promise<{ ok: boolean; motivo?: string }>;
}

export interface PortaPin {
  /** o hash vem do banco (`scrypt$…`); o PIN em claro nunca é guardado. */
  verificar(hash: string, pin: string): Promise<boolean>;
}
