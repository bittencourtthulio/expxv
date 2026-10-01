// Tipos de IPC de workspaces, provedores, missões e método (Fases 2 e 4). Tipos puros.
// Os validadores vivem no main (src/main/ipc/*) e reconstroem cada payload campo a campo.
import type { EstadoMissao, Handoff, Mission, ModoMissao, OrigemMissao, Pane, Pagina, Papel, Permissao, Task, Workspace, Conta, AcessoExterno } from "../nucleo/dominio";
import type { EventoRastro, IndiceProjeto } from "../nucleo/metodo/tipos";
import type { FerramentaDetectada } from "./terminais";

export type { Workspace, Mission, Pane, Task, Handoff, Conta, Pagina, Permissao, AcessoExterno, EstadoMissao, ModoMissao, OrigemMissao, Papel };
export type { IndiceProjeto, EventoRastro };

// ---- workspaces ----
export interface WorktreeInfo {
  /** caminho relativo à pasta pai do repositório (ex.: `../repo--slug`) ou `.` para a árvore principal. */
  caminho: string;
  branch: string | null;
  principal: boolean;
  /** sujo/limpo quando já conhecido; null se ainda não medido. */
  sujo: boolean | null;
}

export interface EstadoWorkspaces {
  atual: Workspace | null;
  recentes: Workspace[];
}

// ---- provedores ----
export interface ProvedorInfo {
  ferramenta: FerramentaDetectada;
  contas: Conta[];
}

// ---- missões ----
export interface PedidoCriarMissao {
  workspace_id: string;
  modo: ModoMissao;
  origem: OrigemMissao;
  titulo: string;
  /** texto livre do pedido (vira prompt inicial do piloto/comando do método). */
  pedido: string;
  /** CLI por papel; `piloto` obrigatório nos modos squad e agentico. */
  clis: Partial<Record<Papel, string>>;
}

export interface DetalheMissao {
  mission: Mission;
  panes: Pane[];
  tasks: Task[];
  handoffs: Handoff[];
}

// ---- método ----
export type GestoMetodo =
  | "nova_feature"
  | "nova_ocorrencia"
  | "pedido_cru"
  | "projeto"
  | "retomar"
  | "auditar"
  | "qa"
  | "entrega_check"
  | "entrega_atencao"
  | "entrega_qa"
  | "entrega_pr";

export interface ComandoSugerido {
  /** texto exato a digitar no Pane (já com o prefixo do harness e o argumento). */
  comando: string;
  /** o gesto exige Pane separado do implementador (auditoria, QA, atenção do mergex). */
  pane_separado: boolean;
  /** ação que é sempre humana: a UI leva ao arquivo em vez de disparar. */
  somente_humano: boolean;
  motivo_bloqueio: string | null;
}

export interface PedidoDispararComando {
  workspace_id: string;
  trabalho_id: string | null;
  gesto: GestoMetodo;
  /** argumento livre (pedido/texto do chamado) quando o gesto pede. */
  argumento: string | null;
  /** Pane de destino; null = abrir um novo. */
  pane_id: string | null;
}

export interface ResultadoDisparo {
  ok: boolean;
  pane_id: string | null;
  comando: string | null;
  motivo: string | null;
}

export interface ResumoMudancaMetodo {
  workspace_id: string;
  trabalhos: number;
  violacoes: number;
  gerado_em: string;
}

// ---- portões de intake da Missão (piloto → usuário) ----
export const PORTOES_MISSAO = ["direction", "content", "build", "qa"] as const;
export type PortaoMissao = (typeof PORTOES_MISSAO)[number];

export interface EstadoPortoes {
  mission_id: string;
  liberados: PortaoMissao[];
  pendentes: PortaoMissao[];
}
