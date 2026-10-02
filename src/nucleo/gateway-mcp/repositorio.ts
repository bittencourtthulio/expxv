// Porta de persistência do gateway (implementada por `banco/repos/gateway.ts`). Só METADADO: nunca argumento de tool, resultado, segredo nem token.
import type { ConfigGateway, EntradaAuditoriaGateway, PedidoConfigGateway } from "../../compartilhado/catalogo";
import type { RegraFiltro } from "./tipos";

export const RETENCAO_AUDITORIA_DIAS = 30;

/** Linha de `gateway_pane`: o snapshot do Pane (R-3). `dados_json` = `{ ids, agente_id, raiz_rel, via }`; nunca caminho absoluto. */
export interface RegistroPaneGateway {
  pane_id: string;
  workspace_id: string;
  mission_id: string | null;
  papel: string;
  modo: string;
  dados_json: string;
  criado_em: string;
  expira_em: string;
}

export interface RepoGateway {
  config(workspaceId: string): ConfigGateway;
  gravarConfig(pedido: PedidoConfigGateway, agora: string): ConfigGateway;
  regras(workspaceId: string): RegraFiltro[];
  definirRegra(workspaceId: string, regra: RegraFiltro, agora: string): void;
  gravarPane(r: RegistroPaneGateway): void;
  obterPane(paneId: string): RegistroPaneGateway | null;
  removerPane(paneId: string): void;
  /** apaga os vencidos; devolve quantos */
  podarPanes(agoraIso: string): number;
  registrarAuditoria(e: EntradaAuditoriaGateway): void;
  listarAuditoria(workspaceId: string | null, limite: number): EntradaAuditoriaGateway[];
  podarAuditoria(antesDeIso: string): number;
}

export const CONFIG_PADRAO_GATEWAY = { ativo: false, modo_superficie: "reduzido", max_ferramentas: 40, limite_por_min: 60, ocioso_s: 300 } as const;
