/**
 * Servidor MCP do app (T-03.01, D-13): HTTP em 127.0.0.1, porta efêmera, sem CORS, corpo ≤ 1 MiB,
 * Host/Origin só loopback (DNS rebinding), `Authorization: Bearer <token de Pane>`.
 *
 * Modo stateless: cada requisição lê o token de novo, cria um `Server` MCP ligado às claims daquele
 * token e o descarta ao fim — não há sessão para sequestrar e uma revogação vale na próxima chamada.
 * Sem acesso a banco ou chaves: tudo o que a tool precisa entra por portas (`DepsTools`).
 * Rotas: `POST /mcp` (MCP) e `POST /hooks/<evento>` (scripts de hook por Pane, mesmo token).
 */
import { createServer, type IncomingMessage, type Server as ServidorHttp, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PRODUTO } from "../produto";
import { DEFINICOES, TOOLS_MVP, type NomeTool } from "./catalogo";
import { ErroMcp, argumentoInvalido, corpoDeErro, naoAutorizado, violacaoDeRegra } from "./erros";
import type { PortaGanchos, PortaGateway } from "./portas";
import type { ContextoTool, DepsTools } from "./tools/comum";
import { IMPLEMENTACOES } from "./tools/index";
import { criarEmissorDeTokens, temAudiencia, type AudienciaToken, type ClaimsToken, type EmissorDeTokens, type PedidoToken } from "./tokens";

export const LIMITE_CORPO_BYTES = 1024 * 1024;

export interface OpcoesServidorMcp {
  deps: DepsTools;
  emissor?: EmissorDeTokens;
  ganchos?: PortaGanchos;
  /** 0 = porta efêmera (padrão) */
  porta?: number;
  /** tenta esta porta primeiro (a do início anterior); ocupada → cai para a efêmera */
  portaPreferida?: number;
}

export interface ServidorMcp {
  /** `http://127.0.0.1:<porta>/mcp` */
  url: string;
  /** base dos ganchos: `http://127.0.0.1:<porta>/hooks` */
  urlGanchos: string;
  porta: number;
  emitirToken(pedido: PedidoToken): string;
  revogar(pane_id: string): void;
  fechar(): Promise<void>;
}

const HOST_LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i;

export function hostEhLoopback(valor: string | undefined): boolean {
  return valor !== undefined && HOST_LOOPBACK.test(valor);
}

export function origemEhLoopback(valor: string | undefined): boolean {
  if (valor === undefined) return true; // clientes não-navegador não enviam Origin
  try {
    const u = new URL(valor);
    return (u.protocol === "http:" || u.protocol === "https:") && HOST_LOOPBACK.test(u.host);
  } catch {
    return false;
  }
}

function responderJson(res: ServerResponse, status: number, corpo: unknown, extra: Record<string, string> = {}): void {
  if (res.headersSent) return;
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(texto), "cache-control": "no-store", ...extra });
  res.end(texto);
}

class CorpoGrande extends Error {}

function lerCorpo(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    const declarado = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declarado) && declarado > LIMITE_CORPO_BYTES) {
      rejeitar(new CorpoGrande());
      return;
    }
    const pedacos: Buffer[] = [];
    let total = 0;
    req.on("data", (p: Buffer) => {
      total += p.length;
      if (total > LIMITE_CORPO_BYTES) {
        rejeitar(new CorpoGrande());
        req.destroy();
        return;
      }
      pedacos.push(p);
    });
    req.on("end", () => resolver(Buffer.concat(pedacos)));
    req.on("error", rejeitar);
  });
}

function resultadoErro(erro: unknown): { isError: true; content: Array<{ type: "text"; text: string }> } {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(corpoDeErro(erro)) }] };
}

/**
 * Fase 7C: servidor MCP do gateway para UM Pane (stateless). `tools/list` e `tools/call` são delegados à porta do main; o token só entrega a identidade
 * (`pane_id`). Erros viram `isError` com o corpo do contrato; nada de argumento/resultado é logado aqui.
 */
function montarServidorGateway(claims: ClaimsToken, porta: PortaGateway): Server {
  const servidor = new Server({ name: `${PRODUTO.id}-gateway`, version: "1.0.0" }, { capabilities: { tools: {} } });
  servidor.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      return { tools: (await porta.listar(claims.pane_id)).tools };
    } catch {
      return { tools: [] };
    }
  });
  servidor.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = req.params.arguments;
    if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) return resultadoErro(argumentoInvalido("Os argumentos devem ser um objeto."));
    try {
      const r = await porta.chamar(claims.pane_id, req.params.name, (args ?? {}) as Record<string, unknown>);
      return { content: r.content.map((c) => ({ type: "text" as const, text: String(c.text) })), isError: r.isError };
    } catch (erro) {
      return resultadoErro(erro);
    }
  });
  return servidor;
}

function montarServidorMcp(claims: ClaimsToken, deps: DepsTools): Server {
  const servidor = new Server({ name: `${PRODUTO.id}-mcp`, version: "1.0.0" }, { capabilities: { tools: {} } });

  servidor.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS_MVP.filter((n) => claims.tools_allow.includes(n)).map((n) => DEFINICOES[n]),
  }));

  servidor.setRequestHandler(CallToolRequestSchema, async (req) => {
    const nome = req.params.name;
    const ctx: ContextoTool = { claims, deps };
    if (!(TOOLS_MVP as readonly string[]).includes(nome)) return resultadoErro(new ErroMcp("not_found", `Tool desconhecida: ${nome}.`));
    if (!claims.tools_allow.includes(nome)) {
      return resultadoErro(violacaoDeRegra("forbidden_role", `A tool "${nome}" não está disponível para este Pane.`));
    }
    try {
      const saida = await IMPLEMENTACOES[nome as NomeTool](req.params.arguments ?? {}, ctx);
      return { content: [{ type: "text" as const, text: JSON.stringify(saida) }] };
    } catch (erro) {
      return resultadoErro(erro);
    }
  });
  return servidor;
}

export async function iniciarServidorMcp(opcoes: OpcoesServidorMcp): Promise<ServidorMcp> {
  const emissor = opcoes.emissor ?? criarEmissorDeTokens();

  async function tratar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 1) Host/Origin: só loopback (DNS rebinding); nada de CORS
    if (!hostEhLoopback(req.headers.host) || !origemEhLoopback(req.headers.origin)) {
      responderJson(res, 403, { code: "unauthorized", message: "Host ou origem não permitidos." });
      return;
    }
    const caminho = (req.url ?? "").split("?")[0] ?? "";
    const ehMcp = caminho === "/mcp";
    const ehGancho = /^\/hooks\/[a-z][a-z0-9-]{0,39}$/.test(caminho);
    const ehLoja = caminho === "/loja/segredos";
    const ehGateway = caminho === "/gateway";
    if (!ehMcp && !ehGancho && !ehLoja && !ehGateway) {
      responderJson(res, 404, { code: "not_found", message: "Rota desconhecida." });
      return;
    }
    if (req.method !== "POST") {
      responderJson(res, 405, { code: "invalid_argument", message: "Só POST." }, { allow: "POST" });
      return;
    }
    // 2) token de Pane, relido a cada chamada
    const cabecalho = req.headers.authorization ?? "";
    const m = /^Bearer\s+(\S+)$/i.exec(cabecalho);
    const claims = m === null ? null : emissor.verificar(m[1] as string);
    if (claims === null) {
      responderJson(res, 401, naoAutorizado().corpo(), { "www-authenticate": "Bearer" });
      return;
    }
    // 2b) audiência (Fase 7C, R-1): cada rota exige a SUA; o token geral do Pane (ambiente do agente) não lê segredo nem usa o gateway
    const exigida: AudienciaToken = ehLoja ? "loja-launcher" : ehGateway ? "gateway" : ehGancho ? "hooks" : "mcp";
    if (!temAudiencia(claims, exigida)) {
      responderJson(res, 401, naoAutorizado().corpo(), { "www-authenticate": "Bearer" });
      return;
    }
    // 3) corpo ≤ 1 MiB
    let bruto: Buffer;
    try {
      bruto = await lerCorpo(req);
    } catch (e) {
      responderJson(res, e instanceof CorpoGrande ? 413 : 400, { code: e instanceof CorpoGrande ? "too_large" : "invalid_argument", message: "Corpo inválido ou grande demais." });
      return;
    }
    let corpo: unknown;
    try {
      corpo = bruto.length === 0 ? {} : JSON.parse(bruto.toString("utf8"));
    } catch {
      responderJson(res, 400, { code: "invalid_argument", message: "JSON inválido." });
      return;
    }

    if (ehGateway) {
      const porta = opcoes.deps.gateway;
      if (porta === undefined) {
        responderJson(res, 404, { code: "not_found", message: "Gateway desativado." });
        return;
      }
      const servidorGw = montarServidorGateway(claims, porta);
      const transporteGw = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
      res.on("close", () => {
        void transporteGw.close();
        void servidorGw.close();
      });
      await servidorGw.connect(transporteGw as unknown as Transport);
      await transporteGw.handleRequest(req, res, corpo);
      return;
    }

    if (ehLoja) {
      // Fase 7B (D-132): segredos de um servidor da Loja para o lançador `mcp-run`. A identidade é do token; o corpo só diz QUAL servidor.
      // Nada do corpo nem da resposta é logado; `cache-control: no-store` vale para toda resposta (responderJson).
      const porta = opcoes.deps.loja;
      if (porta === undefined) {
        responderJson(res, 404, { code: "not_found", message: "Loja desativada." });
        return;
      }
      const servidor = typeof corpo === "object" && corpo !== null && !Array.isArray(corpo) ? (corpo as Record<string, unknown>)["servidor"] : undefined;
      try {
        const r = await porta.segredos(claims.pane_id, servidor);
        responderJson(res, r.status, r.corpo);
      } catch {
        responderJson(res, 500, { code: "unavailable", message: "Falha ao resolver os segredos." });
      }
      return;
    }

    if (ehGancho) {
      if (opcoes.ganchos === undefined) {
        responderJson(res, 404, { code: "not_found", message: "Ganchos desativados." });
        return;
      }
      const evento = caminho.slice("/hooks/".length);
      try {
        const r = await opcoes.ganchos.tratar(evento, { workspace_id: claims.workspace_id, mission_id: claims.mission_id, pane_id: claims.pane_id }, corpo);
        responderJson(res, 200, r.saida ?? {});
      } catch {
        responderJson(res, 500, { code: "unavailable", message: "Falha ao tratar o gancho." });
      }
      return;
    }

    const servidorMcp = montarServidorMcp(claims, opcoes.deps);
    // stateless: `sessionIdGenerator: undefined` explícito (o tipo do SDK não aceita `undefined` com exactOptionalPropertyTypes)
    const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
    res.on("close", () => {
      void transporte.close();
      void servidorMcp.close();
    });
    await servidorMcp.connect(transporte as unknown as Transport);
    await transporte.handleRequest(req, res, corpo);
  }

  const http: ServidorHttp = createServer((req, res) => {
    tratar(req, res).catch(() => responderJson(res, 500, { code: "unavailable", message: "Falha interna." }));
  });
  http.maxHeadersCount = 64;
  const escutar = (porta: number): Promise<void> =>
    new Promise<void>((ok, erro) => {
      http.once("error", erro);
      http.listen(porta, "127.0.0.1", () => { http.off("error", erro); ok(); });
    });
  // porta preferida (a do início anterior): sessões recuperadas do daemon guardam a URL antiga; ocupada → efêmera
  if (opcoes.portaPreferida !== undefined && opcoes.portaPreferida > 0) {
    await escutar(opcoes.portaPreferida).catch(() => escutar(0));
  } else {
    await escutar(opcoes.porta ?? 0);
  }
  const porta = (http.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${porta}/mcp`,
    urlGanchos: `http://127.0.0.1:${porta}/hooks`,
    porta,
    emitirToken: (pedido) => emissor.emitir(pedido),
    revogar: (pane_id) => emissor.revogar(pane_id),
    fechar: () =>
      new Promise<void>((ok) => {
        http.close(() => ok());
        http.closeAllConnections();
      }),
  };
}
