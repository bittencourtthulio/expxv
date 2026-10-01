import { afterEach, describe, expect, it } from "vitest";
import { abrirSessao, alvoFalso, ambienteMinimo, derrubarTodos, MODOS_FALSOS, pidsVivosDoUtilitario, pidVivo, subirFalso } from "./servidores";
import { handshake, listarFerramentas, SessaoStdio } from "../../../src/nucleo/loja-mcp/verificacao";

afterEach(async () => { await derrubarTodos(); });

async function ate<T>(f: () => T | undefined, ms = 2000): Promise<T | undefined> {
  const t0 = Date.now();
  for (;;) {
    const r = f();
    if (r !== undefined || Date.now() - t0 > ms) return r;
    await new Promise((res) => setTimeout(res, 20));
  }
}

describe("servidores MCP falsos (protocolo de verdade por stdio)", () => {
  it("ok: initialize, tools/list com 3 ferramentas e tools/call (eco, soma)", async () => {
    const s = await abrirSessao("ok");
    const info = await handshake(s);
    expect(info.nome).toBe("falso-ok");
    expect((await listarFerramentas(s)).map((t) => t.nome)).toEqual(["eco", "soma", "hora_falsa"]);
    const eco = (await s.pedir("tools/call", { name: "eco", arguments: { texto: "olá" } })) as { content: Array<{ text: string }> };
    expect(eco.content[0]!.text).toBe("olá");
    const soma = (await s.pedir("tools/call", { name: "soma", arguments: { a: 2, b: 3 } })) as { content: Array<{ text: string }> };
    expect(soma.content[0]!.text).toBe("5");
  });

  it("vazio: initialize ok e tools/list vazio", async () => {
    const s = await abrirSessao("vazio");
    await handshake(s);
    expect(await listarFerramentas(s)).toEqual([]);
  });

  it("lento: não responde antes do atraso configurado (mas responde depois)", async () => {
    const s = await abrirSessao("lento", ambienteMinimo({ FALSO_ATRASO_MS: "700" }));
    const t0 = performance.now();
    await handshake(s);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(600);
  });

  it("crash: responde initialize e sai com código 1 ao listar ferramentas", async () => {
    const f = subirFalso("crash");
    let codigo: number | null | undefined;
    f.filho.once("exit", (c) => { codigo = c; });
    f.filho.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } })}\n`);
    f.filho.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    f.filho.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    expect(await ate(() => codigo ?? undefined)).toBe(1);
  });

  it("lixo: a primeira linha do stdout não é JSON", async () => {
    const f = subirFalso("lixo");
    let primeira = "";
    f.filho.stdout!.setEncoding("utf8");
    f.filho.stdout!.on("data", (d: string) => { if (!primeira) primeira = d.split("\n")[0]!; });
    await ate(() => primeira || undefined);
    expect(() => JSON.parse(primeira)).toThrow();
  });

  it("exige-variavel: sem FALSO_API_KEY sai com 2 citando só o nome; com a chave certa funciona", async () => {
    const f = subirFalso("exige-variavel");
    let codigo: number | null | undefined;
    let erro = "";
    f.filho.stderr!.setEncoding("utf8");
    f.filho.stderr!.on("data", (d: string) => { erro += d; });
    f.filho.once("exit", (c) => { codigo = c; });
    expect(await ate(() => codigo ?? undefined)).toBe(2);
    expect(erro).toContain("FALSO_API_KEY");

    const s = await abrirSessao("exige-variavel", ambienteMinimo({ FALSO_API_KEY: "chave-valida" }));
    await handshake(s);
    expect((await listarFerramentas(s)).length).toBe(3);
  });

  it("exige-variavel com chave errada: tools/list devolve 401 sem repetir o valor", async () => {
    const s = await abrirSessao("exige-variavel", ambienteMinimo({ FALSO_API_KEY: "valor-secreto-errado" }));
    await handshake(s);
    const e = await listarFerramentas(s).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toMatch(/401/);
    expect((e as Error).message).not.toContain("valor-secreto-errado");
  });

  it("eco-ambiente: lista exatamente os NOMES do ambiente que recebeu", async () => {
    const s = await abrirSessao("eco-ambiente", { PATH: process.env["PATH"] ?? "/usr/bin", FALSO_VISIVEL: "1" });
    await handshake(s);
    const r = (await s.pedir("tools/call", { name: "listar_ambiente", arguments: {} })) as { content: Array<{ text: string }> };
    const nomes = JSON.parse(r.content[0]!.text) as string[];
    expect(nomes).toContain("FALSO_VISIVEL");
    expect(nomes).not.toContain("HOME");
  });

  it("segredo-no-stderr: escreve o valor no stderr (o app é quem redige)", async () => {
    const s = new SessaoStdio(alvoFalso("segredo-no-stderr", ambienteMinimo({ FALSO_API_KEY: "abc123xyz" })));
    await handshake(s);
    expect(s.stderr).toContain("abc123xyz");
    await s.encerrar();
  });
});

describe("utilitário subir/derrubar", () => {
  it("todos os modos existem como arquivo e sobem", () => {
    for (const modo of MODOS_FALSOS) expect(alvoFalso(modo).args[0]).toMatch(new RegExp(`${modo}\\.mjs$`));
  });

  it("derrubarTodos mata os processos subidos e não deixa nenhum vivo", async () => {
    const a = subirFalso("ok");
    const b = subirFalso("lento");
    expect(pidVivo(a.pid)).toBe(true);
    expect(pidsVivosDoUtilitario().length).toBe(2);
    await derrubarTodos();
    expect(pidVivo(a.pid)).toBe(false);
    expect(pidVivo(b.pid)).toBe(false);
    expect(pidsVivosDoUtilitario()).toEqual([]);
  });

  it("derrubar de um servidor só é idempotente", async () => {
    const a = subirFalso("ok");
    await a.derrubar();
    await a.derrubar();
    expect(pidVivo(a.pid)).toBe(false);
  });
});
