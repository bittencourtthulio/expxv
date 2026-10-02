// Tradução entre o contrato externo das tools MCP (inglês snake_case) e o domínio (português sem acento).
import type { EscopoMemoria, TipoMemoria } from "./tipos";

export const KIND_PARA_TIPO: Readonly<Record<string, TipoMemoria>> = {
  decision: "decisao", risk: "risco", fact: "fato", checkpoint: "checkpoint", learning: "aprendizado", preference: "preferencia",
  event: "evento", handoff: "handoff", summary: "resumo",
};
export const TIPO_PARA_KIND: Readonly<Record<TipoMemoria, string>> = {
  decisao: "decision", risco: "risk", fato: "fact", checkpoint: "checkpoint", aprendizado: "learning", preferencia: "preference",
  evento: "event", handoff: "handoff", resumo: "summary",
};
export const ESCOPO_PARA_SCOPE: Readonly<Record<EscopoMemoria, string>> = { pane: "pane", missao: "mission", squad: "squad", workspace: "workspace", usuario: "user" };
export const SCOPE_BUSCA = ["pane", "mission", "workspace", "all_rings"] as const;
export type ScopeBusca = (typeof SCOPE_BUSCA)[number];
