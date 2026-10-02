// Portas do Jarvis (T-13.08): o núcleo nunca fala com serviço real. O main injeta adaptadores sobre Maestro/squads (orquestrador), portões, consultas, painéis e navegação.
// Ausência ou falha de uma porta = recusa/indisponível (falha SEGURA). As formas de consulta/gates/rigidez são as MESMAS do Telegram (reuso, sem duplicar).
import type { PlanoRemoto } from "../../compartilhado/alertas";
import type { EstadoPlanoRemoto, MotivoRecusa, PortaConsulta, PortaGates, PortaRigidez } from "../telegram/portas-entrada";
import type { LinhaPane } from "./snapshot";

export type { PortaConsulta, PortaGates, PortaRigidez, LinhaPane };

/** Igual a `PortaOrquestrador` do Telegram, com a origem do pedido do Jarvis/remoto (o adaptador do main mapeia para a via remota do Maestro: só sobe rigidez). */
export interface PortaOrquestradorJarvis {
  proporPlano(p: { workspace_id: string; texto_redigido: string; origem: "jarvis" | "remoto"; usuario_ref: string }): Promise<PlanoRemoto | { recusado: MotivoRecusa }>;
  planoAtual(plano_id: string): Promise<PlanoRemoto | null>;
  executarPlano(plano_id: string, aprovacao: { aprovado_por: string; args_hash: string }): Promise<{ iniciado: boolean; mission_id?: string; motivo?: string }>;
  /** cancela a proposta ou pausa a execução; NUNCA apaga Pane/worktree. */
  pararPlano(plano_id: string): Promise<boolean>;
  estadoPlano?(plano_id: string): EstadoPlanoRemoto;
}

export interface PortaPaineis {
  listar(): Promise<LinhaPane[]>;
}
export interface AlvoControle {
  id: string;
  rotulo: string;
  estado: string;
}
export interface PortaControle {
  alvos(): Promise<AlvoControle[]>;
  /** para o avanço; NUNCA apaga Pane nem worktree. */
  pausar(id: string): Promise<boolean>;
  parar(id: string): Promise<boolean>;
}
export interface PortaNavegacao {
  /** pede ao renderer para focar o painel; o main valida a referência. */
  abrirPane(ref: string): Promise<{ ok: boolean }>;
}
