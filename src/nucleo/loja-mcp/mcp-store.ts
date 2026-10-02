// Visão da Loja para o AGENTE (tool `mcp_store_list`, D-138): só leitura e só o que está habilitado e configurado para o Pane. PURO.
// Nunca devolve URL, argumentos, variáveis, caminhos nem descrição de terceiro: só identificação curta e nomes de ferramenta
// (dado de terceiro é dado, não instrução: nomes passam por lista de caracteres permitidos).
import { normalizar } from "./catalogo";
import type { EntradaMcp } from "./esquema";

export const LIMITE_PADRAO_MCP_STORE = 25;
export const LIMITE_MAXIMO_MCP_STORE = 100;
export const MAX_TOOLS_POR_SERVIDOR = 20;

export interface FiltroMcpStore { query: string | null; category: string | null; limit: number }
export interface ServidorMcpStore { id: string; name: string; category: string; transport: string; tools: string[]; enabled_for_you: true }

/** Nome de ferramenta aceito: o alfabeto do protocolo MCP, até 64 caracteres. Qualquer outra coisa é descartada. */
const NOME_TOOL_SEGURO = /^[A-Za-z0-9_.:-]{1,64}$/;
const nomeSeguro = (n: string): string => n.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);

/**
 * `entradas` já são as habilitadas e configuradas do Pane (o main as resolve do snapshot, conferindo instalado e não bloqueado).
 * `ferramentasVistas(id)` são as do último teste de saúde; sem teste, cai nas `tools_principais` curadas do seed.
 */
export function listarServidoresParaAgente(
  entradas: readonly EntradaMcp[],
  ferramentasVistas: (id: string) => readonly string[],
  filtro: FiltroMcpStore,
): { servers: ServidorMcpStore[] } {
  const q = filtro.query === null ? "" : normalizar(filtro.query).trim();
  const limite = Math.min(LIMITE_MAXIMO_MCP_STORE, Math.max(1, Math.trunc(filtro.limit)));
  const servers = entradas
    .filter((e) => (filtro.category === null || e.categoria === filtro.category) && (q === "" || normalizar(`${e.id} ${e.nome} ${e.descricao_pt}`).includes(q)))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id))
    .slice(0, limite)
    .map((e): ServidorMcpStore => {
      const vistas = ferramentasVistas(e.id);
      const fonte = vistas.length > 0 ? vistas : e.tools_principais;
      return {
        id: e.id,
        name: nomeSeguro(e.nome),
        category: e.categoria,
        transport: e.transporte,
        tools: fonte.filter((t) => NOME_TOOL_SEGURO.test(t)).slice(0, MAX_TOOLS_POR_SERVIDOR),
        enabled_for_you: true,
      };
    });
  return { servers };
}
