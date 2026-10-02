import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { criarMundo } from "../../../tests/fixtures/mcp/dubles";
import { hostEhLoopback, iniciarServidorMcp, origemEhLoopback, type ServidorMcp } from "./servidor";
import { criarEmissorDeTokens } from "./tokens";

let servidor: ServidorMcp | null = null;
afterEach(async () => {
  await servidor?.fechar();
  servidor = null;
});

async function subir(opcoes: { modo?: "livre" | "squad" | "agentico" } = {}) {
  const mundo = criarMundo(opcoes);
  const emissor = criarEmissorDeTokens();
  servidor = await iniciarServidorMcp({ deps: mundo.deps, emissor });
  return { mundo, emissor, servidor };
}

async function cliente(url: string, token: string): Promise<Client> {
  const c = new Client({ name: "teste", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }) as unknown as Transport);
  return c;
}

const pedidoPiloto = { workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_p", role: "piloto" as const, mode: "agentico" as const };

function postar(porta: number, caminho: string, headers: Record<string, string>, corpo = "{}"): Promise<{ status: number; corpo: string }> {
  return new Promise((ok, erro) => {
    const r = request({ host: "127.0.0.1", port: porta, path: caminho, method: "POST", headers: { "content-length": Buffer.byteLength(corpo), "content-type": "application/json", ...headers } }, (res) => {
      const p: Buffer[] = [];
      res.on("data", (d: Buffer) => p.push(d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, corpo: Buffer.concat(p).toString() }));
    });
    r.on("error", erro);
    r.end(corpo);
  });
}

describe("servidor MCP", () => {
  it("escuta só em 127.0.0.1, porta efêmera", async () => {
    const { servidor: s } = await subir();
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(s.porta).toBeGreaterThan(0);
  });

  it("um cliente MCP de teste lista e chama tools com token de Pane", async () => {
    const { servidor: s } = await subir();
    const c = await cliente(s.url, s.emitirToken(pedidoPiloto));
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toContain("pane_spawn");
    const r = await c.callTool({ name: "provider_list", arguments: {} });
    expect(JSON.parse((r.content as Array<{ text: string }>)[0]?.text ?? "")).toHaveLength(2);
    await c.close();
  });

  it("sem token, token adulterado ou expirado → 401 unauthorized", async () => {
    let agora = Date.now();
    const mundo = criarMundo();
    const emissor = criarEmissorDeTokens({ relogio: { agora: () => agora }, ttlMs: 1000 });
    servidor = await iniciarServidorMcp({ deps: mundo.deps, emissor });
    const h = { host: `127.0.0.1:${servidor.porta}`, accept: "application/json, text/event-stream" };
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const semToken = await postar(servidor.porta, "/mcp", h, body);
    expect(semToken.status).toBe(401);
    expect(JSON.parse(semToken.corpo)).toMatchObject({ code: "unauthorized" });
    const t = servidor.emitirToken(pedidoPiloto);
    const adulterado = `${t.slice(0, -2)}${t.endsWith("AA") ? "BB" : "AA"}`;
    expect((await postar(servidor.porta, "/mcp", { ...h, authorization: `Bearer ${adulterado}` }, body)).status).toBe(401);
    expect((await postar(servidor.porta, "/mcp", { ...h, authorization: "Basic abc" }, body)).status).toBe(401);
    expect((await postar(servidor.porta, "/mcp", { ...h, authorization: `Bearer ${t}` }, body)).status).toBe(200);
    agora += 2000;
    expect((await postar(servidor.porta, "/mcp", { ...h, authorization: `Bearer ${t}` }, body)).status).toBe(401);
  });

  it("revogar vale já na próxima chamada (token relido a cada chamada)", async () => {
    const { servidor: s } = await subir();
    const token = s.emitirToken(pedidoPiloto);
    const c = await cliente(s.url, token);
    await c.listTools();
    s.revogar("pane_p");
    await expect(c.listTools()).rejects.toThrow();
    await c.close().catch(() => undefined);
  });

  it("tools/list é filtrado pelo token: tool fora da lista nem aparece; chamar mesmo assim → forbidden_role", async () => {
    const { servidor: s } = await subir();
    const c = await cliente(s.url, s.emitirToken({ ...pedidoPiloto, pane_id: "w1", role: "executor" }));
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual(["handoff_submit"]);
    const r = await c.callTool({ name: "pane_spawn", arguments: { provider: "claude" } });
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content as Array<{ text: string }>)[0]?.text ?? "")).toMatchObject({ code: "rule_violation", subcode: "forbidden_role" });
    const desconhecida = await c.callTool({ name: "tool_que_nao_existe", arguments: {} });
    expect(JSON.parse((desconhecida.content as Array<{ text: string }>)[0]?.text ?? "")).toMatchObject({ code: "not_found" });
    await c.close();
  });

  it("harness_set só aparece em tools/list do piloto agêntico com o opt-in `piloto_edita_politica` no token", async () => {
    const { servidor: s } = await subir({ modo: "agentico" });
    const base = { workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_p", role: "piloto", mode: "agentico" } as const;
    const sem = await cliente(s.url, s.emitirToken(base));
    expect((await sem.listTools()).tools.map((t) => t.name)).not.toContain("harness_set");
    await sem.close();
    const com = await cliente(s.url, s.emitirToken({ ...base, piloto_edita_politica: true }));
    const nomes = (await com.listTools()).tools.map((t) => t.name);
    expect(nomes).toContain("harness_set");
    expect(nomes).toHaveLength(28); // + handoff_read (D-520); + task_list/task_get/cost_report (Fase 10); + as 5 tools `memory_*` (Fase 8) + `mcp_store_list` (Fase 7B)
    await com.close();
    // worker nunca vê, mesmo com o opt-in
    const worker = await cliente(s.url, s.emitirToken({ ...base, pane_id: "pane_w", role: "executor", piloto_edita_politica: true }));
    expect((await worker.listTools()).tools.map((t) => t.name)).toEqual(["handoff_submit"]);
    await worker.close();
  });

  it.each([
    ["livre", "nenhum", 9], // + handoff_read (D-520)
    ["squad", "piloto", 17], // + handoff_read (D-520) + catalog_list (Fase 7) + harness_list e headline_limits (Fase 9) + mcp_store_list (Fase 7B) + task_list/task_get/cost_report (Fase 10)
    ["agentico", "piloto", 27], // + handoff_read (D-520) + 3 do board/custo (Fase 10) + 5 da memória (Fase 8) + 6 da Fase 9 (inclui account_switch) + mcp_store_list (Fase 7B); `harness_set` só com o opt-in do workspace (teste abaixo)
  ] as const)("matriz por modo via protocolo: %s/%s expõe %i tools", async (modo, role, quantas) => {
    const { servidor: s } = await subir({ modo });
    const c = await cliente(s.url, s.emitirToken({ workspace_id: "ws_1", mission_id: modo === "livre" ? null : "mis_1", pane_id: "pane_p", role, mode: modo }));
    expect((await c.listTools()).tools).toHaveLength(quantas);
    await c.close();
  });

  it("erros saem como { code, subcode, message } no corpo do resultado", async () => {
    const { servidor: s } = await subir();
    const c = await cliente(s.url, s.emitirToken(pedidoPiloto));
    const r = await c.callTool({ name: "pane_spawn", arguments: { provider: "gemini" } });
    expect(r.isError).toBe(true);
    const corpo = JSON.parse((r.content as Array<{ text: string }>)[0]?.text ?? "");
    expect(Object.keys(corpo).sort()).toEqual(["code", "message", "subcode"]);
    await c.close();
  });

  it("Host não-loopback e Origin de site externo são recusados (DNS rebinding)", async () => {
    const { servidor: s } = await subir();
    const t = s.emitirToken(pedidoPiloto);
    const base = { authorization: `Bearer ${t}`, accept: "application/json, text/event-stream" };
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect((await postar(s.porta, "/mcp", { ...base, host: "evil.example.com" }, body)).status).toBe(403);
    expect((await postar(s.porta, "/mcp", { ...base, host: `evil.example.com:${s.porta}` }, body)).status).toBe(403);
    expect((await postar(s.porta, "/mcp", { ...base, host: `127.0.0.1:${s.porta}`, origin: "https://evil.example.com" }, body)).status).toBe(403);
    expect((await postar(s.porta, "/mcp", { ...base, host: `127.0.0.1:${s.porta}`, origin: "http://localhost:3000" }, body)).status).toBe(200);
  });

  it("sem CORS aberto; só POST; rotas desconhecidas 404", async () => {
    const { servidor: s } = await subir();
    const t = s.emitirToken(pedidoPiloto);
    const r = await fetch(s.url, { method: "OPTIONS", headers: { origin: "http://localhost:1" } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    expect(r.status).toBe(405);
    expect((await fetch(s.url, { method: "GET", headers: { authorization: `Bearer ${t}` } })).status).toBe(405);
    expect((await fetch(`http://127.0.0.1:${s.porta}/outra`, { method: "POST", headers: { authorization: `Bearer ${t}` } })).status).toBe(404);
  });

  it("corpo > 1 MiB → 413; JSON inválido → 400", async () => {
    const { servidor: s } = await subir();
    const t = s.emitirToken(pedidoPiloto);
    const h = { host: `127.0.0.1:${s.porta}`, authorization: `Bearer ${t}`, accept: "application/json, text/event-stream" };
    const grande = await postar(s.porta, "/mcp", h, JSON.stringify({ x: "a".repeat(1024 * 1024 + 10) })).catch(() => ({ status: 413, corpo: "" }));
    expect(grande.status).toBe(413);
    expect((await postar(s.porta, "/mcp", h, "{isto nao e json")).status).toBe(400);
  });

  it("ganchos: rota /hooks exige o mesmo token e chama a porta injetada", async () => {
    const mundo = criarMundo();
    const emissor = criarEmissorDeTokens();
    const vistos: unknown[] = [];
    servidor = await iniciarServidorMcp({ deps: mundo.deps, emissor, ganchos: { tratar: async (evento, ctx, corpo) => { vistos.push({ evento, ctx, corpo }); return { saida: { ok: true } }; } } });
    const t = servidor.emitirToken({ ...pedidoPiloto, pane_id: "w1", role: "executor" });
    const sem = await postar(servidor.porta, "/hooks/stop-handoff", { host: `127.0.0.1:${servidor.porta}` });
    expect(sem.status).toBe(401);
    const com = await postar(servidor.porta, "/hooks/stop-handoff", { host: `127.0.0.1:${servidor.porta}`, authorization: `Bearer ${t}` }, '{"a":1}');
    expect(JSON.parse(com.corpo)).toEqual({ ok: true });
    expect(vistos).toEqual([{ evento: "stop-handoff", ctx: { workspace_id: "ws_1", mission_id: "mis_1", pane_id: "w1" }, corpo: { a: 1 } }]);
  });
});

describe("helpers de loopback", () => {
  it("hostEhLoopback / origemEhLoopback", () => {
    for (const h of ["127.0.0.1", "127.0.0.1:8080", "localhost:1", "[::1]:9"]) expect(hostEhLoopback(h)).toBe(true);
    for (const h of ["evil.com", "127.0.0.1.evil.com", "localhost.evil.com:1", "10.0.0.1", "", undefined]) expect(hostEhLoopback(h)).toBe(false);
    expect(origemEhLoopback(undefined)).toBe(true);
    expect(origemEhLoopback("http://127.0.0.1:3000")).toBe(true);
    expect(origemEhLoopback("https://evil.com")).toBe(false);
    expect(origemEhLoopback("null")).toBe(false);
  });
});
