// Tool `mcp_store_list` (Fase 7B, T-07B.25, D-138): LEITURA dos servidores MCP da Loja habilitados e configurados para ESTE Pane.
// Agente nunca instala, configura nem habilita (anti prompt injection): não existe tool para isso. A identidade (`pane_id`) vem SEMPRE do
// token; a lógica e a política moram no main (`PortaLoja.listar`). Resposta ≤ 4 KB, sem URL, argumentos, variáveis nem descrição.
import { ErroMcp, argumentoInvalido, indisponivel } from "../erros";
import type { ServidorLojaListado } from "../portas";
import { caberEm4Kb } from "./harness";
import { comoObjeto, inteiroOpcional, textoOpcional, type ImplTool } from "./comum";

export const LIMITE_PADRAO_MCP_STORE = 25;
const CATEGORIA = /^[a-z][a-z_]{0,63}$/;

export const mcpStoreList: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const query = textoOpcional(a, "query", 100);
  const categoria = textoOpcional(a, "category", 64);
  if (categoria !== null && !CATEGORIA.test(categoria)) throw argumentoInvalido('O campo "category" tem formato inválido.');
  const limite = inteiroOpcional(a, "limit", 1, 100) ?? LIMITE_PADRAO_MCP_STORE;
  const porta = deps.loja;
  if (porta?.listar === undefined) throw indisponivel("A Loja de MCPs não está disponível.");
  let servers: ServidorLojaListado[];
  try {
    servers = (await porta.listar(claims.pane_id, { query, category: categoria, limit: limite })).servers;
  } catch (e) {
    if (e instanceof ErroMcp) throw e;
    throw indisponivel("Não foi possível listar os servidores da Loja.");
  }
  // copia campo a campo: nada além do contrato atravessa, mesmo que a porta entregue mais
  const limpos = servers.slice(0, limite).map((s): ServidorLojaListado => ({ id: s.id, name: s.name, category: s.category, transport: s.transport, tools: s.tools.slice(0, 20), enabled_for_you: true }));
  return caberEm4Kb(limpos, (itens, extra) => ({ servers: itens, ...extra }));
};
