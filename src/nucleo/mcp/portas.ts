/**
 * Portas injetadas no servidor MCP: o que ele precisa do app, sem importar missoes/*, provedores/*,
 * banco ou terminais. O main implementa cada interface sobre os serviços reais (ver index.ts).
 * Vocabulário das portas é o do domínio (PT, sem acento); a tradução para o contrato externo
 * (inglês) acontece nas tools.
 */
import type { EstadoMissao, EstadoPane, ModoMissao, Papel, StatusHandoff } from "../dominio";

export type Portao = "direction" | "content" | "build" | "qa";
export const PORTOES: readonly Portao[] = ["direction", "content", "build", "qa"];

export interface PaneInfo {
  pane_id: string;
  workspace_id: string;
  mission_id: string | null;
  provedor: string;
  papel: Papel;
  estado: EstadoPane;
  task_id: string | null;
  eh_piloto: boolean;
}

export interface PedidoSpawn {
  workspace_id: string;
  mission_id: string | null;
  /** quem pediu (pane do token) */
  pedido_por_pane_id: string;
  provedor: string;
  modelo: string | null;
  conta_id: string | null;
  papel: Papel;
  agente_id: string | null;
  briefing_path: string | null;
  cwd: string | null;
}

export interface PortaPanes {
  /** Cria o Pane (visível na UI) e devolve só o id. Falha de infraestrutura: lance qualquer erro (vira `unavailable`). */
  spawn(pedido: PedidoSpawn): Promise<{ pane_id: string }>;
  /** Panes vivos do workspace; `mission_id` null = panes fora de Missão. Encerrados não entram. */
  listar(filtro: { workspace_id: string; mission_id: string | null }): Promise<PaneInfo[]>;
  obter(pane_id: string): Promise<PaneInfo | null>;
  /** Últimas `ultimas` linhas da tela (já limitadas pelo chamador). */
  ler(pane_id: string, ultimas: number): Promise<{ linhas: string[]; estado: EstadoPane } | null>;
  /** Digita no Pane. `enviar` resolve false se o Pane não aceita entrada. */
  enviar(pane_id: string, texto: string, submeter: boolean): Promise<boolean>;
  fechar(pane_id: string, motivo: string): Promise<boolean>;
}

export interface AgenteDoSquad {
  agente_id: string;
  papel: Papel;
}

export interface MissaoInfo {
  mission_id: string;
  workspace_id: string;
  modo: ModoMissao;
  estado: EstadoMissao;
  titulo: string;
  piloto_pane_id: string | null;
  /** Portões de intake já liberados pelo usuário. */
  portoes_liberados: readonly Portao[];
  /** Agentes do squad (modo squad/agentico com squad); `null` = sem restrição de squad. */
  agentes_do_squad: readonly AgenteDoSquad[] | null;
}

export interface PortaMissoes {
  obter(mission_id: string): Promise<MissaoInfo | null>;
  listar(filtro: { workspace_id: string; estado?: EstadoMissao }): Promise<MissaoInfo[]>;
  /** Conclui a Missão (transição para `concluida`). */
  concluir(mission_id: string): Promise<void>;
}

export interface ProvedorInfo {
  provedor: string;
  cli: string;
  contas: string[];
  habilitado: boolean;
}

export interface ModeloInfo {
  modelo: string;
  /** o padrão da própria CLI (sem `--model`). */
  padrao?: boolean;
  niveis_esforco: string[];
}

export interface PortaProvedores {
  /** Todos os provedores conhecidos com o flag de habilitação; o MCP só expõe os habilitados. */
  listar(workspace_id: string): Promise<ProvedorInfo[]>;
  modelos(provedor: string): Promise<ModeloInfo[]>;
}

export interface PedidoHandoff {
  workspace_id: string;
  mission_id: string | null;
  /** Pane que entrega e seu papel: vêm do token. */
  pane_id: string;
  papel: Papel;
  task_id: string;
  resumo: string;
  relatorio_path: string;
  artefatos: string[];
  status: StatusHandoff;
}

export interface HandoffRegistrado {
  handoff_id: string;
  relatorio_path: string | null;
  status: StatusHandoff;
}

/** Implementada por orquestracao/handoff.ts (relatório → banco → wake). */
export interface PortaHandoff {
  registrar(pedido: PedidoHandoff): Promise<{ handoff_id: string }>;
  /** Último handoff registrado pelo Pane (stop hook). */
  doPane(pane_id: string): Promise<HandoffRegistrado | null>;
  /** A Missão tem handoff `ok` de um Pane de papel revisor? (mission_complete) */
  temRevisorOk(mission_id: string): Promise<boolean>;
}

export interface PortaRelogio {
  /** ms desde a época. */
  agora(): number;
}

export const relogioReal: PortaRelogio = { agora: () => Date.now() };

/** Resposta de um gancho (hook) para o script: o corpo JSON que o script imprime e o código de saída. */
export interface RespostaGancho {
  saida: Record<string, unknown> | null;
}

export interface ContextoGancho {
  workspace_id: string;
  mission_id: string | null;
  pane_id: string;
}

/** Implementada por orquestracao/hooks/claude.ts. Só é chamada com token de Pane válido. */
export interface PortaGanchos {
  tratar(evento: string, contexto: ContextoGancho, corpo: unknown): Promise<RespostaGancho>;
}
