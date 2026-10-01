import { afterEach, describe, expect, it } from "vitest";
import { criarClienteRest, type ConfigRest } from "./rest";
import { ForgeAutenticacaoErro, ForgeBranchProtegidaErro, ForgeEntradaInvalidaErro, ForgeNaoEncontradoErro, ForgePermissaoErro, ForgeRateLimitErro, ForgeRedeErro } from "./erros";
import { criarServidorFake, type ServidorFake } from "../../../tests/fixtures/forge/servidor-rest";

let srv: ServidorFake | undefined;
afterEach(async () => {
  await srv?.fechar();
  srv = undefined;
});
const SEGREDO = "tok_SUPERSECRETO_123456";
const cfg = (url: string, extra: Partial<ConfigRest> = {}): ConfigRest => ({ repo: { host: "x.example", caminho: "a/b" }, credencial: async () => ({ esquema: "Bearer", valor: SEGREDO }), baseUrl: url, permitirLoopback: true, ...extra });

describe("cliente REST", () => {
  it("só aceita https (http só em loopback e com permissão)", () => {
    expect(() => criarClienteRest("bitbucket", cfg("http://exemplo.invalid"), "")).toThrow(ForgeEntradaInvalidaErro);
    expect(() => criarClienteRest("bitbucket", cfg("http://127.0.0.1:1", { permitirLoopback: false }), "")).toThrow(ForgeEntradaInvalidaErro);
    expect(() => criarClienteRest("bitbucket", cfg("https://u:p@exemplo.invalid"), "")).toThrow(ForgeEntradaInvalidaErro);
    expect(criarClienteRest("bitbucket", cfg("https://api.exemplo.invalid/2.0/"), "").base).toBe("https://api.exemplo.invalid/2.0");
  });
  it("envia Bearer e Basic (codificando usuario:senha) e JSON no corpo", async () => {
    srv = await criarServidorFake({ "POST /x": { json: { ok: 1 } } });
    const b = criarClienteRest("bitbucket", cfg(srv.url), "");
    const r = await b.requisitar("POST", "x", { acao: "t", corpo: { a: 1 } });
    expect(r.json).toEqual({ ok: 1 });
    expect(srv.pedidos[0]?.cabecalhos.authorization).toBe(`Bearer ${SEGREDO}`);
    expect(JSON.parse(srv.pedidos[0]?.corpo ?? "")).toEqual({ a: 1 });
    const c = criarClienteRest("azure", cfg(srv.url, { credencial: async () => ({ esquema: "Basic", valor: ":pat" }) }), "");
    await c.requisitar("POST", "x", { acao: "t" });
    expect(srv.pedidos[1]?.cabecalhos.authorization).toBe(`Basic ${Buffer.from(":pat").toString("base64")}`);
  });
  it("sem credencial vira ForgeAutenticacaoErro e nada sai", async () => {
    srv = await criarServidorFake();
    const c = criarClienteRest("azure", cfg(srv.url, { credencial: async () => undefined }), "");
    await expect(c.requisitar("GET", "x", { acao: "t" })).rejects.toBeInstanceOf(ForgeAutenticacaoErro);
    expect(srv.pedidos).toHaveLength(0);
    expect(await c.temCredencial()).toBe(false);
  });
  it("mapeia 401/403/404/429/branch protegida em erros nominais", async () => {
    srv = await criarServidorFake({ "GET /a": { status: 401, texto: "unauthorized" }, "GET /b": { status: 403, texto: "forbidden" }, "GET /c": { status: 404, texto: "x" }, "GET /d": { status: 429, texto: "too many requests" }, "POST /e": { status: 409, texto: "branch restriction: required status check pending, merge blocked" } });
    const c = criarClienteRest("bitbucket", cfg(srv.url), "");
    await expect(c.requisitar("GET", "a", { acao: "t" })).rejects.toBeInstanceOf(ForgeAutenticacaoErro);
    await expect(c.requisitar("GET", "b", { acao: "t" })).rejects.toBeInstanceOf(ForgePermissaoErro);
    await expect(c.requisitar("GET", "c", { acao: "t" })).rejects.toBeInstanceOf(ForgeNaoEncontradoErro);
    await expect(c.requisitar("GET", "d", { acao: "t" })).rejects.toBeInstanceOf(ForgeRateLimitErro);
    await expect(c.requisitar("POST", "e", { acao: "t" })).rejects.toBeInstanceOf(ForgeBranchProtegidaErro);
  });
  it("a credencial NUNCA aparece no erro, mesmo se o servidor a ecoar", async () => {
    srv = await criarServidorFake({ "GET /eco": { status: 500, texto: `erro interno token ${SEGREDO} Authorization: Bearer ${SEGREDO}` } });
    const c = criarClienteRest("bitbucket", cfg(srv.url), "");
    const e = await c.requisitar("GET", "eco", { acao: "t" }).catch((x: Error) => x);
    const texto = JSON.stringify({ m: (e as Error).message, d: (e as { detalhe?: string }).detalhe, s: (e as Error).stack });
    expect(texto).not.toContain(SEGREDO);
    expect(texto.toLowerCase()).not.toContain("authorization");
  });
  it("não segue redirecionamento (não vaza Authorization)", async () => {
    const alvo = await criarServidorFake({ "GET /destino": { json: {} } });
    srv = await criarServidorFake({ "GET /r": { status: 302, cabecalhos: { location: `${alvo.url}/destino` } } });
    const c = criarClienteRest("bitbucket", cfg(srv.url), "");
    await expect(c.requisitar("GET", "r", { acao: "t" })).rejects.toBeInstanceOf(ForgeRedeErro);
    expect(alvo.pedidos).toHaveLength(0);
    await alvo.fechar();
  });
  it("trunca corpo grande com marca e não tenta parsear", async () => {
    srv = await criarServidorFake({ "GET /g": { bytes: 2 * 1024 * 1024 } });
    const c = criarClienteRest("bitbucket", cfg(srv.url), "");
    const r = await c.requisitar("GET", "g", { acao: "t", maxBytes: 1000 });
    expect(r.truncado).toBe(true);
    expect(r.texto.length).toBe(1000);
    expect(r.json).toBeUndefined();
  });
  it("timeout vira ForgeRedeErro e cancelamento propaga", async () => {
    srv = await criarServidorFake({ "GET /lento": { json: {}, atrasoMs: 500 } });
    const c = criarClienteRest("bitbucket", cfg(srv.url, { timeoutMs: 80 }), "");
    await expect(c.requisitar("GET", "lento", { acao: "t" })).rejects.toBeInstanceOf(ForgeRedeErro);
    const ctl = new AbortController();
    const p = criarClienteRest("bitbucket", cfg(srv.url), "").requisitar("GET", "lento", { acao: "t", signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toBeDefined();
  });
  it("log de 50 MB em streaming sem acumular", async () => {
    srv = await criarServidorFake({ "GET /log": { bytes: 50 * 1024 * 1024 } });
    const c = criarClienteRest("bitbucket", cfg(srv.url), "");
    let total = 0;
    let maior = 0;
    const r = await c.stream("log", { acao: "t", aoPedaco: (t) => ((total += t.length), (maior = Math.max(maior, t.length))) });
    expect(r.bytes).toBe(50 * 1024 * 1024);
    expect(r.truncado).toBe(false);
    expect(total).toBe(r.bytes);
    expect(maior).toBeLessThan(2 * 1024 * 1024);
    const t = await c.stream("log", { acao: "t", maxBytes: 1024, aoPedaco: () => undefined });
    expect(t).toEqual({ bytes: 1024, truncado: true });
  });
});
