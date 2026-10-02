// Modo efetivo da memória por Pane (T-08.06) — função pura. Tabela (com P-21/P-24):
//   global off | workspace off | Missão off  → off          shell → off
//   sem Missão ou Missão `livre`              → solo (se `solo` ligado e a CLI tem MCP) senão off
//   Missão `agentico`                         → missao       Missão `squad` → squad (se `squad` ligado) senão off
import type { ConfigMemoria } from "../../compartilhado/memoria";
import type { ModoMemoria } from "./tipos";

export interface EntradaModo {
  config: Pick<ConfigMemoria, "ativa" | "solo" | "squad">;
  global_ativa: boolean;
  /** override da Missão: null/undefined = herda do workspace. */
  missao_ativa?: boolean | null;
  pane: { tipo: "cli" | "shell" };
  missao: { modo: "livre" | "squad" | "agentico" } | null;
  /** a CLI do Pane fala MCP (`recursosDaFerramenta(cli).mcp`); sem MCP não há como gravar. */
  cli_tem_mcp: boolean;
}

export function resolverModo(e: EntradaModo): ModoMemoria {
  if (!e.global_ativa || !e.config.ativa) return "off";
  if (e.missao_ativa === false) return "off";
  if (e.pane.tipo === "shell") return "off";
  if (e.missao === null || e.missao.modo === "livre") return e.config.solo && e.cli_tem_mcp ? "solo" : "off";
  if (e.missao.modo === "agentico") return "missao";
  return e.config.squad ? "squad" : "off";
}
