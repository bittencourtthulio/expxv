// Gateway de ponta a ponta, sem rede externa: servidor MCP do app REAL (HTTP em 127.0.0.1) + agregador + conector do SDK + servidor MCP falso por stdio (processo
// de verdade). Prova: endpoint único, audiências do token (R-1), filtro, namespace, ambiente mínimo do servidor, saída limitada, nenhuma credencial no caminho do Pane.
import { request } from "node:http";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it } from "vitest";
import { criarMundo } from "../../../tests/fixtures/mcp/dubles";
import { iniciarServidorMcp, type ServidorMcp } from "../mcp/servidor";
import type { PortaGateway } from "../mcp/portas";
import { criarAgregador, type Agregador } from "./agregador";
import { criarConector } from "./conector";
import type { EntradaAuditoria, RegraFiltro, SnapshotGateway } from "./tipos";

const FIXTURE = resolve(__dirname, "../../../tests/fixtures/gateway/servidor-gw.mjs");
const SEGREDO = "chave-do-servidor-que-o-pane-nunca-ve";

let servidor: ServidorMcp | null = null;
let agregador: Agregador | null = null;
afterEach(async () => {
  await agregador?.encerrar();
  await servidor?.fechar();
  servidor = null;
  agregador = null;
});

async function montar(opcoes: { modo?: SnapshotGateway["modo"]; regras?: RegraFiltro[]; maxSaidaBytes?: number } = {}) {
  const auditoria: EntradaAuditoria[] = [];
  const snap: SnapshotGateway = { pane_id: "pane_1", workspace_id: "ws_1", mission_id: null, agente_id: null, papel: "executor", modo: opcoes.modo ?? "livre", servidores: ["falso"], raiz: null };
  process.env["ANTHROPIC_API_KEY"] = "sk-ant-AMBIENTE-DO-APP";
  const conector = criarConector({
    resolver: async (id) => {
      if (id !== "falso") throw new Error("desconhecido");
      return { tipo: "stdio", executavel: process.execPath, args: [FIXTURE], env: { SEGREDO_DO_SERVIDOR: SEGREDO, FALSO_LENTA_MS: "800" }, cwd: null };
    },
  });
  agregador = criarAgregador({
    snapshot: (p) => (p === "pane_1" ? snap : null),
    config: () => ({ ativo: true, modo_superficie: "completo", max_ferramentas: 40, limite_por_min: 100, ocioso_s: 300 }),
    regras: () => opcoes.regras ?? [],
    conectar: conector,
    auditar: (e) => auditoria.push(e),
    tempoChamadaMs: 300,
    ...(opcoes.maxSaidaBytes === undefined ? {} : { maxSaidaBytes: opcoes.maxSaidaBytes }),
  });
  const ag = agregador;
  const porta: PortaGateway = { listar: (p) => ag.listar(p), chamar: (p, n, a) => ag.chamar(p, n, a) };
  servidor = await iniciarServidorMcp({ deps: { ...criarMundo().deps, gateway: porta } });
  const s = servidor;
  const tok = (aud: Array<"mcp" | "hooks" | "gateway" | "loja-launcher"> | undefined, pane = "pane_1"): string =>
    s.emitirToken({ ...(aud === undefined ? {} : { aud }), workspace_id: "ws_1", mission_id: null, pane_id: pane, role: "nenhum", mode: "livre", tools_allow: [] });
  const cliente = async (token: string): Promise<Client> => {
    const c = new Client({ name: "teste", version: "1" }, { capabilities: {} });
    await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${s.porta}/gateway`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }) as unknown as Transport);
    return c;
  };
  return { s, tok, cliente, auditoria };
}

function post(porta: number, caminho: string, token: string | null, corpo: unknown = {}): Promise<number> {
  const texto = JSON.stringify(corpo);
  return new Promise((ok, erro) => {
    const r = request({ host: "127.0.0.1", port: porta, path: caminho, method: "POST", headers: { host: `127.0.0.1:${porta}`, "content-type": "application/json", accept: "application/json, text/event-stream", "content-length": Buffer.byteLength(texto), ...(token === null ? {} : { authorization: `Bearer ${token}` }) } }, (res) => {
      res.resume();
      res.on("end", () => ok(res.statusCode ?? 0));
    });
    r.on("error", erro);
    r.end(texto);
  });
}

describe("gateway MCP: endpoint único em loopback", () => {
  it("lista e chama ferramentas de um servidor real por stdio, com namespace; o ambiente do app NÃO chega ao servidor", async () => {
    const { tok, cliente } = await montar();
    const c = await cliente(tok(["gateway"]));
    const { tools } = await c.listTools();
    const nomes = tools.map((t) => t.name);
    expect(nomes).toEqual(expect.arrayContaining(["falso__get_item", "falso__delete_item", "falso__write_note", "falso__sync"]));
    expect(nomes.some((n) => n.includes("ponto"))).toBe(false); // `nome.com ponto` tem espaço: descartado
    const r = (await c.callTool({ name: "falso__get_item", arguments: { id: "7" } })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(r.content[0]!.text).toBe("item:7");
    const amb = (await c.callTool({ name: "falso__ambiente", arguments: {} })) as { content: Array<{ text: string }> };
    const vars = JSON.parse(amb.content[0]!.text) as string[];
    expect(vars).toContain("SEGREDO_DO_SERVIDOR");
    expect(vars.filter((v) => /ANTHROPIC|EXPXV|TOKEN/.test(v))).toEqual([]);
    await c.close();
  });

  it("descrição maliciosa de terceiro chega como TEXTO saneado; a lista nunca ecoa o segredo do servidor", async () => {
    const { tok, cliente } = await montar();
    const c = await cliente(tok(["gateway"]));
    const { tools } = await c.listTools();
    const sync = tools.find((t) => t.name === "falso__sync")!;
    expect(sync.description).not.toMatch(/[‮\u001b<>]/);
    expect(JSON.stringify(tools)).not.toContain(SEGREDO);
    await c.close();
  });

  it("squad: escrita fica de fora; a chamada direta à escrita é negada mesmo conhecendo o nome", async () => {
    const { tok, cliente, auditoria } = await montar({ modo: "squad" });
    const c = await cliente(tok(["gateway"]));
    const nomes = (await c.listTools()).tools.map((t) => t.name);
    expect(nomes).toContain("falso__get_item");
    expect(nomes).not.toContain("falso__delete_item");
    const r = (await c.callTool({ name: "falso__delete_item", arguments: { id: "1" } })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0]!.text)).toMatchObject({ code: "rule_violation", subcode: "forbidden_role" });
    expect(auditoria.at(-1)).toMatchObject({ decisao: "negada_filtro" });
    await c.close();
  });

  it("saída enorme é cortada e a chamada lenta estoura o tempo sem travar o gateway", async () => {
    const { tok, cliente } = await montar({ maxSaidaBytes: 4096 });
    const c = await cliente(tok(["gateway"]));
    const g = (await c.callTool({ name: "falso__grande", arguments: {} })) as { content: Array<{ text: string }> };
    expect(Buffer.byteLength(g.content.map((x) => x.text).join(""))).toBeLessThan(5000);
    expect(g.content.at(-1)!.text).toContain("saída cortada");
    const l = (await c.callTool({ name: "falso__lenta", arguments: {} })) as { isError?: boolean };
    expect(l.isError).toBe(true);
    const depois = (await c.callTool({ name: "falso__get_item", arguments: { id: "9" } })) as { content: Array<{ text: string }> };
    expect(depois.content[0]!.text).toBe("item:9");
    await c.close();
  });

  it("audiências (R-1): só o token `gateway` usa /gateway; o token do gateway não usa /mcp, /hooks nem /loja/segredos; o geral não usa /gateway", async () => {
    const { s, tok } = await montar();
    expect(await post(s.porta, "/gateway", null)).toBe(401);
    expect(await post(s.porta, "/gateway", tok(undefined))).toBe(401);
    expect(await post(s.porta, "/gateway", tok(["mcp", "hooks"]))).toBe(401);
    expect(await post(s.porta, "/gateway", tok(["loja-launcher"]))).toBe(401);
    expect(await post(s.porta, "/mcp", tok(["gateway"]))).toBe(401);
    expect(await post(s.porta, "/hooks/pre-mcp", tok(["gateway"]))).toBe(401);
    expect(await post(s.porta, "/loja/segredos", tok(["gateway"]), { servidor: "falso" })).toBe(401);
    expect(await post(s.porta, "/loja/segredos", tok(undefined), { servidor: "falso" })).toBe(401);
    expect(await post(s.porta, "/gateway", tok(["gateway"]), { jsonrpc: "2.0", id: 1, method: "tools/list" })).toBe(200);
  });

  it("revogar o Pane invalida o token do gateway na próxima chamada", async () => {
    const { s, tok } = await montar();
    const t = tok(["gateway"]);
    expect(await post(s.porta, "/gateway", t, { jsonrpc: "2.0", id: 1, method: "tools/list" })).toBe(200);
    s.revogar("pane_1");
    expect(await post(s.porta, "/gateway", t, { jsonrpc: "2.0", id: 1, method: "tools/list" })).toBe(401);
  });

  it("Host fora do loopback é recusado (DNS rebinding)", async () => {
    const { s, tok } = await montar();
    const status = await new Promise<number>((ok, erro) => {
      const r = request({ host: "127.0.0.1", port: s.porta, path: "/gateway", method: "POST", headers: { host: "evil.example.com", authorization: `Bearer ${tok(["gateway"])}`, "content-type": "application/json" } }, (res) => { res.resume(); res.on("end", () => ok(res.statusCode ?? 0)); });
      r.on("error", erro);
      r.end("{}");
    });
    expect(status).toBe(403);
  });
});
