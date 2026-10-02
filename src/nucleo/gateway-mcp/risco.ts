// Risco informativo de uma ferramenta de terceiro: usa as anotações do protocolo (`readOnlyHint`/`destructiveHint`) quando o servidor as declara e, sem
// elas, o nome. É só heurística: serve de DEFAULT em Missões `squad`/`agentico` (escrita/desconhecido ficam fora até haver regra explícita); nunca é prova.
import type { FerramentaRemota } from "./tipos";

const LEITURA = /^(get|list|read|search|find|query|describe|show|fetch|view|count|lookup|check|status|info|inspect|browse|resolve|explain|preview)([_\-.A-Z0-9]|$)/i;
const ESCRITA = /(^|[_\-.])(create|update|delete|remove|write|set|send|post|put|patch|push|merge|drop|exec|execute|run|deploy|insert|upsert|commit|apply|install|uninstall|kill|stop|start|reset|publish|invoke|click|type|upload|transfer|pay|charge|refund)([_\-.]|$)/i;

export function riscoDaFerramenta(f: Pick<FerramentaRemota, "nome" | "somente_leitura" | "destrutiva">): "leitura" | "escrita" | "desconhecido" {
  if (f.destrutiva === true) return "escrita";
  if (f.somente_leitura === true) return ESCRITA.test(f.nome) ? "desconhecido" : "leitura"; // dica de leitura com nome de escrita: não confia
  if (ESCRITA.test(f.nome)) return "escrita";
  if (LEITURA.test(f.nome)) return "leitura";
  return "desconhecido";
}
