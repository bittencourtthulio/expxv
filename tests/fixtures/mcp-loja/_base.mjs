// Base dos servidores MCP FALSOS de teste (Fase 7B, T-07B.06). Falam o protocolo de verdade por stdio
// usando o SDK oficial; nunca tocam a rede e nunca instalam nada. Comportamento por variável de ambiente
// com o prefixo FALSO_ (nada de segredo real).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ nome: string, versao?: string, ferramentas?: Array<{name: string, description: string, inputSchema: object}>,
 *   chamar?: (nome: string, args: any) => any, aoListar?: () => any, aoInicializar?: () => void,
 *   antes?: () => Promise<void> | void }} cfg
 */
export async function iniciarServidor(cfg) {
  if (cfg.antes) await cfg.antes();
  const servidor = new Server({ name: cfg.nome, version: cfg.versao ?? "0.0.1" }, { capabilities: { tools: {} } });
  const ferramentas = cfg.ferramentas ?? FERRAMENTAS_PADRAO;
  servidor.setRequestHandler(ListToolsRequestSchema, async () => {
    if (cfg.aoListar) { const r = cfg.aoListar(); if (r) return r; }
    return { tools: ferramentas };
  });
  servidor.setRequestHandler(CallToolRequestSchema, async (req) => {
    const nome = req.params.name;
    if (cfg.chamar) return { content: [{ type: "text", text: String(await cfg.chamar(nome, req.params.arguments ?? {})) }] };
    if (nome === "eco") return { content: [{ type: "text", text: String(req.params.arguments?.texto ?? "") }] };
    if (nome === "soma") return { content: [{ type: "text", text: String(Number(req.params.arguments?.a) + Number(req.params.arguments?.b)) }] };
    throw new McpError(-32602, `ferramenta desconhecida: ${nome}`);
  });
  if (cfg.aoInicializar) servidor.oninitialized = cfg.aoInicializar;
  await servidor.connect(new StdioServerTransport());
  // encerra quando o cliente fecha o stdin (não deixa processo órfão)
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("close", () => process.exit(0));
  return servidor;
}

export const FERRAMENTAS_PADRAO = [
  { name: "eco", description: "Devolve o texto recebido.", inputSchema: { type: "object", properties: { texto: { type: "string" } } } },
  { name: "soma", description: "Soma dois números.", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },
  { name: "hora_falsa", description: "Devolve uma hora fixa (servidor falso de teste).", inputSchema: { type: "object", properties: {} } },
];
