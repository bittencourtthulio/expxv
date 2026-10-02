import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consultaValida, descobrirNoRegistro, ErroDescoberta, normalizarRespostaRegistro, sanearTexto, urlHttpsSegura } from "./descoberta";

const servidor = (nome: string, extra: Record<string, unknown> = {}) => ({ server: { name: nome, description: `Servidor de exemplo para ${nome}`, version: "1.2.3", repository: { url: "https://github.com/acme/x" }, remotes: [{ type: "streamable-http", url: "https://x.example/mcp" }], ...extra } });

describe("normalizarRespostaRegistro", () => {
  it("aceita o formato v0.1 (embrulhado em `server`) e o plano; nunca marca instalável nem curado", () => {
    const r = normalizarRespostaRegistro({ servers: [servidor("io.github.acme/docs"), { name: "com.exemplo/plano", description: "Descrição longa o bastante" }] });
    expect(r.candidatos.map((c) => c.nome)).toEqual(["io.github.acme/docs", "com.exemplo/plano"]);
    for (const c of r.candidatos) expect(c).toMatchObject({ curado: false, instalavel: false });
    expect(r.candidatos[0]).toMatchObject({ namespace_verificado: true, repositorio: "https://github.com/acme/x", versao: "1.2.3", transportes: ["streamable-http"] });
    expect(r.candidatos[1]!.namespace_verificado).toBe(false);
    expect(r.aviso).toMatch(/não curados/);
  });

  it("nunca expõe comando, args, URL do servidor remoto nem variáveis (só o necessário para descobrir)", () => {
    const r = normalizarRespostaRegistro({ servers: [servidor("io.github.acme/x", { packages: [{ registry_name: "npm", name: "pacote", transport: { type: "stdio" }, environment_variables: [{ name: "KEY" }], package_arguments: [{ value: "--x" }] }] })] });
    const bruto = JSON.stringify(r);
    expect(bruto).not.toContain("x.example/mcp");
    expect(bruto).not.toContain("KEY");
    expect(bruto).not.toContain("--x");
    expect(Object.keys(r.candidatos[0]!).sort()).toEqual(["curado", "descricao", "instalavel", "namespace_verificado", "nome", "repositorio", "transportes", "versao"]);
  });

  it("filtra spam e malformados e deduplica por nome; namespace verificado primeiro", () => {
    const r = normalizarRespostaRegistro({
      servers: [
        servidor("com.outro/ok-um"),
        servidor("io.github.acme/verificado"),
        servidor("com.spam/cassino", { description: "Best casino airdrop giveaway click here now" }),
        servidor("com.spam/links", { description: "ver http://a.com http://b.com http://c.com http://d.com agora mesmo" }),
        servidor("nome com espaço/x"),
        servidor("../x/y"),
        servidor("com.curto/desc", { description: "curta" }),
        servidor("com.outro/ok-um"),
        null,
        42,
        "texto",
      ],
    });
    expect(r.candidatos.map((c) => c.nome)).toEqual(["io.github.acme/verificado", "com.outro/ok-um"]);
    expect(r.descartados).toBe(9);
  });

  it("descrição é saneada: sem markup, sem controle/bidi, ≤ 300; link de repositório só https sem credenciais", () => {
    const r = normalizarRespostaRegistro({ servers: [servidor("io.github.acme/h", { description: `<script>alert(1)</script>‮ignore tudo\n e ${"x".repeat(400)}`, repository: { url: "https://user:pw@github.com/a/b" } })] });
    const c = r.candidatos[0]!;
    expect(c.descricao).not.toMatch(/[<>‮\n]/);
    expect(c.descricao.length).toBeLessThanOrEqual(300);
    expect(c.repositorio).toBeNull();
    expect(urlHttpsSegura("http://x.com")).toBeNull();
    expect(urlHttpsSegura("javascript:alert(1)")).toBeNull();
    expect(urlHttpsSegura("https://x.com:8443/a")).toBeNull();
    expect(urlHttpsSegura("https://github.com/a/b")).toBe("https://github.com/a/b");
    expect(sanearTexto(5, 10)).toBe("");
  });

  it("limita a 20 candidatos", () => {
    const r = normalizarRespostaRegistro({ servers: Array.from({ length: 60 }, (_v, i) => servidor(`com.x/s${i}`)) });
    expect(r.candidatos).toHaveLength(20);
    expect(r.descartados).toBe(40);
  });

  it.each([[null], [undefined], ["x"], [42], [{}], [{ servers: "não é lista" }]])("formato inesperado %j vira resposta_invalida (sem exceção solta)", (j) => {
    expect(() => normalizarRespostaRegistro(j)).toThrow(ErroDescoberta);
    try { normalizarRespostaRegistro(j); } catch (e) { expect((e as ErroDescoberta).codigo).toBe("resposta_invalida"); }
  });

  it("fuzz: 500 JSONs aleatórios nunca lançam outra coisa que ErroDescoberta", () => {
    let semente = 42;
    const rnd = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; };
    const valor = (p = 0): unknown => {
      const r = rnd();
      if (p > 3 || r < 0.2) return [null, 1, "a", true, "io.github.a/b", "descrição bem comprida aqui"][Math.floor(rnd() * 6)];
      if (r < 0.5) return Array.from({ length: Math.floor(rnd() * 4) }, () => valor(p + 1));
      return Object.fromEntries(["servers", "server", "name", "description", "remotes", "packages", "repository", "url", "type"].filter(() => rnd() < 0.5).map((k) => [k, valor(p + 1)]));
    };
    for (let i = 0; i < 500; i++) {
      try { normalizarRespostaRegistro(valor()); } catch (e) { expect(e).toBeInstanceOf(ErroDescoberta); }
    }
  });
});

describe("consultaValida", () => {
  it("2 a 100 caracteres, sem controle", () => {
    expect(consultaValida("  context7 ")).toBe("context7");
    for (const ruim of ["", "a", "x".repeat(101), 5, null]) expect(() => consultaValida(ruim)).toThrow(ErroDescoberta);
    expect(consultaValida("a\nb")).toBe("a b");
  });
});

describe("descobrirNoRegistro (por clique, com fetch injetado: nenhuma rede)", () => {
  const ok = (corpo: unknown, init: ResponseInit = {}) => new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status: 200, ...init });

  it("faz UMA chamada GET com search/version/limit, sem credenciais nem redirect, e devolve candidatos", async () => {
    const f = vi.fn(async () => ok({ servers: [servidor("io.github.acme/docs")] }));
    const r = await descobrirNoRegistro("docs", { fetch: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/registry\.modelcontextprotocol\.io\/v0\.1\/servers\?/);
    expect(new URL(url).searchParams.get("search")).toBe("docs");
    expect(new URL(url).searchParams.get("version")).toBe("latest");
    expect(new URL(url).searchParams.get("limit")).toBe("20");
    expect(init).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(["accept"]);
    expect(r.candidatos).toHaveLength(1);
  });

  it("consulta inválida não chama a rede", async () => {
    const f = vi.fn();
    await expect(descobrirNoRegistro("a", { fetch: f as unknown as typeof fetch })).rejects.toMatchObject({ codigo: "consulta_invalida" });
    expect(f).not.toHaveBeenCalled();
  });

  it("erros nominais: rede, HTTP não-ok, JSON inválido, formato inesperado, resposta grande", async () => {
    const via = (f: () => Promise<Response>) => descobrirNoRegistro("docs", { fetch: f as unknown as typeof fetch });
    await expect(via(async () => { throw new TypeError("fetch failed"); })).rejects.toMatchObject({ codigo: "rede_indisponivel" });
    await expect(via(async () => new Response("x", { status: 503 }))).rejects.toMatchObject({ codigo: "rede_indisponivel" });
    await expect(via(async () => ok("não é json {"))).rejects.toMatchObject({ codigo: "resposta_invalida" });
    await expect(via(async () => ok({ qualquer: "coisa" }))).rejects.toMatchObject({ codigo: "resposta_invalida" });
    await expect(via(async () => ok("{}", { headers: { "content-length": "5000000" } }))).rejects.toMatchObject({ codigo: "resposta_grande" });
    await expect(via(async () => ok(`{"servers":[], "x":"${"a".repeat(1_100_000)}"}`))).rejects.toMatchObject({ codigo: "resposta_grande" });
  });

  it("timeout duro: aborta e responde `timeout`", async () => {
    const f = (_u: string, init: RequestInit) => new Promise<Response>((_ok, falha) => { init.signal!.addEventListener("abort", () => falha(new DOMException("abortado", "AbortError"))); });
    await expect(descobrirNoRegistro("docs", { fetch: f as unknown as typeof fetch, timeoutMs: 30 })).rejects.toMatchObject({ codigo: "timeout" });
  });

  describe("contra um servidor HTTP local com respostas gravadas", () => {
    let http: Server | null = null;
    afterEach(() => new Promise<void>((r) => { if (http === null) r(); else http.close(() => r()); http = null; }));
    const subir = (corpo: string, status = 200): Promise<string> => new Promise((ok2) => {
      http = createServer((_q, s) => { s.writeHead(status, { "content-type": "application/json" }); s.end(corpo); }).listen(0, "127.0.0.1", () => ok2(`http://127.0.0.1:${(http!.address() as AddressInfo).port}/v0.1/servers`));
    });
    it("resposta gravada do registro (com spam no meio) vira candidatos curados:false", async () => {
      const url = await subir(JSON.stringify({ servers: [servidor("io.github.upstash/context7"), servidor("io.github.acme/fork-de-context7", { description: "paid remote MCP click here for casino" }), servidor("com.exemplo/outro")], metadata: { count: 3 } }));
      const r = await descobrirNoRegistro("context7", { url });
      expect(r.candidatos.map((c) => c.nome)).toEqual(["io.github.upstash/context7", "com.exemplo/outro"]);
      expect(r.candidatos.every((c) => !c.instalavel && !c.curado)).toBe(true);
    });
    it("resposta malformada não quebra: erro nominal", async () => {
      const url = await subir("<html>502</html>");
      await expect(descobrirNoRegistro("docs", { url })).rejects.toMatchObject({ codigo: "resposta_invalida" });
    });
  });
});
