// Tools `map_*` (Fase 17, T-17.32): matriz por modo/papel, opt-in do token, validação de caminhos, limites, ≤ 4 KB, `map_not_ready`
// e cliente MCP real chamando `map_impact`. A porta é um dublê; a lógica real do mapa é de `src/nucleo/mapa/**`.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it } from "vitest";
import { claimsDe, criarMundo } from "../../../tests/fixtures/mcp/dubles";
import { DEFINICOES, TOOLS_MAPA, TOOLS_MVP, ferramentasPermitidas } from "./catalogo";
import { CODIGOS_ERRO, ErroMcp, SUBCODIGOS_ERRO } from "./erros";
import type { ImpactoMapaMcp, ItemMapaMcp, PortaMapaMcp, StatusMapaMcp } from "./portas";
import { iniciarServidorMcp, type ServidorMcp } from "./servidor";
import { criarEmissorDeTokens } from "./tokens";
import { IMPLEMENTACOES } from "./tools/index";

type NomeMapa = (typeof TOOLS_MAPA)[number];
const bytes = (o: unknown): number => Buffer.byteLength(JSON.stringify(o), "utf8");

const status = (state: StatusMapaMcp["state"] = "ready"): StatusMapaMcp => ({ state, generated_at: "2026-10-01T10:00:00Z", files: 120, languages: [{ language: "typescript", files: 100, loc: 9000 }], edges: { exact: 300, heuristic: 40 }, stale: false, history: "ok" });
const itens = (n: number, label = "x"): ItemMapaMcp[] => Array.from({ length: n }, (_, i) => ({ id: `arq:src/a${i}.ts`, kind: "file", label: `${label}${i}`, path: `src/a${i}.ts`, line: i + 1, confidence: "exact" as const, metrics: { loc: i } }));
const impacto = (callers = 3): ImpactoMapaMcp => ({
  files: ["src/a.ts"], signals: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, name: `sinal ${id}`, min: 1, max: 2, value: "v", method: "grafo", worst_case: id === 8 })),
  band: "MEDIUM", band_worst_case: "HIGH", worst_case: [{ signal: 8, reason: "dado histórico não coletável" }], seam_candidates: ["src/x.ts#f"], callers: Array.from({ length: callers }, (_, i) => `src/c${i}.ts`), note: "provisório",
});

function dublePorta(sobre: Partial<PortaMapaMcp> = {}) {
  const chamadas: Array<{ metodo: string; ws: string; arg?: unknown }> = [];
  const porta: PortaMapaMcp = {
    disponivel: async (ws) => { chamadas.push({ metodo: "disponivel", ws }); return true; },
    status: async (ws) => { chamadas.push({ metodo: "status", ws }); return status(); },
    query: async (ws, a) => { chamadas.push({ metodo: "query", ws, arg: a }); return { items: itens(3) }; },
    impact: async (ws, a) => { chamadas.push({ metodo: "impact", ws, arg: a }); return impacto(); },
    evidence: async (ws, a) => { chamadas.push({ metodo: "evidence", ws, arg: a }); return { facts: [{ fact: "testes co-localizados", evidence: ["src/a.test.ts:1"], strength: "UNÂNIME", counts: { colocalizado: 10 } }] }; },
    ...sobre,
  };
  return { porta, chamadas };
}
async function chamar(tool: NomeMapa, args: unknown, porta: PortaMapaMcp | null, claims = claimsDe({ mode: "agentico", role: "piloto", mission_id: "mis_1", pane_id: "pane_t", workspace_id: "ws_do_token" })) {
  const m = criarMundo();
  if (porta !== null) m.deps.mapa = porta;
  return IMPLEMENTACOES[tool](args as Record<string, unknown>, { claims, deps: m.deps }) as Promise<Record<string, any>>;
}
async function falha(p: Promise<unknown>): Promise<{ code: string; subcode?: string; message: string }> {
  try { await p; } catch (e) { return (e as ErroMcp).corpo(); }
  throw new Error("não falhou");
}

describe("catálogo e matriz (opt-in do token)", () => {
  it("quatro tools com definição coerente e schema estrito", () => {
    expect([...TOOLS_MAPA]).toEqual(["map_status", "map_query", "map_impact", "map_evidence"]);
    for (const n of TOOLS_MAPA) { expect(TOOLS_MVP).toContain(n); expect(DEFINICOES[n].name).toBe(n); expect(DEFINICOES[n].inputSchema.additionalProperties).toBe(false); }
    expect(DEFINICOES.map_query.inputSchema.required).toEqual(["kind"]);
    expect(DEFINICOES.map_impact.inputSchema.required).toEqual(["files"]);
  });
  it("sem a opção do token, nenhum modo/papel vê map_*; com ela, todos veem as quatro (e nada que escreva)", () => {
    for (const modo of ["livre", "squad", "agentico"] as const) {
      for (const papel of ["piloto", "nenhum", "executor", "explorador", "revisor"] as const) {
        const sem = ferramentasPermitidas(modo, papel);
        for (const t of TOOLS_MAPA) expect(sem).not.toContain(t);
        const com = ferramentasPermitidas(modo, papel, { mapa: true });
        for (const t of TOOLS_MAPA) expect(com).toContain(t);
      }
    }
    expect(TOOLS_MAPA.every((t) => !/(analy|scan|run|write|trigger|dispatch)/.test(t))).toBe(true);
  });
  it("o emissor de tokens só inclui map_* com `mapa: true`", () => {
    const e = criarEmissorDeTokens();
    const base = { workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_1", role: "piloto" as const, mode: "agentico" as const };
    expect(e.verificar(e.emitir(base))?.tools_allow).not.toContain("map_query");
    expect(e.verificar(e.emitir({ ...base, mapa: true }))?.tools_allow).toEqual(expect.arrayContaining([...TOOLS_MAPA]));
  });
  it("`map_not_ready` é subcódigo válido de `unavailable`", () => {
    expect(SUBCODIGOS_ERRO).toContain("map_not_ready");
    expect(CODIGOS_ERRO).toContain("unavailable");
  });
});

describe("identidade, estado e opt-in", () => {
  it("o workspace vem do token e campos extras (workspace_id, path) são recusados", async () => {
    const { porta, chamadas } = dublePorta();
    await chamar("map_query", { kind: "search", target: "foo" }, porta);
    expect(chamadas.find((c) => c.metodo === "query")?.ws).toBe("ws_do_token");
    expect((await falha(chamar("map_query", { kind: "cycles", workspace_id: "ws_outro" }, porta))).code).toBe("invalid_argument");
    expect((await falha(chamar("map_status", { workspace_id: "x" }, porta))).code).toBe("invalid_argument");
  });
  it("sem porta, sem opt-in (disponivel=false) ou sem análise => unavailable/map_not_ready", async () => {
    for (const tool of TOOLS_MAPA) {
      const args = tool === "map_query" ? { kind: "cycles" } : tool === "map_impact" ? { files: ["src/a.ts"] } : tool === "map_evidence" ? { topic: "tests" } : {};
      expect(await falha(chamar(tool, args, null))).toMatchObject({ code: "unavailable", subcode: "map_not_ready" });
      expect(await falha(chamar(tool, args, dublePorta({ disponivel: async () => false }).porta))).toMatchObject({ code: "unavailable", subcode: "map_not_ready" });
    }
    const vazio = dublePorta({ status: async () => status("empty") }).porta;
    expect(await falha(chamar("map_query", { kind: "cycles" }, vazio))).toMatchObject({ code: "unavailable", subcode: "map_not_ready" });
    expect(await falha(chamar("map_impact", { files: ["a.ts"] }, vazio))).toMatchObject({ code: "unavailable", subcode: "map_not_ready" });
    expect(await falha(chamar("map_evidence", { topic: "tests" }, vazio))).toMatchObject({ code: "unavailable", subcode: "map_not_ready" });
    expect((await chamar("map_status", {}, vazio))["state"]).toBe("empty"); // map_status informa mesmo vazio
  });
  it("falha inesperada da porta vira unavailable sem vazar detalhe", async () => {
    const r = await falha(chamar("map_query", { kind: "cycles" }, dublePorta({ query: async () => { throw new Error("SQLITE /Users/x/segredo.db"); } }).porta));
    expect(r).toMatchObject({ code: "unavailable", subcode: "map_not_ready" });
    expect(JSON.stringify(r)).not.toContain("/Users");
  });
});

describe("validação de caminhos e argumentos", () => {
  const { porta } = dublePorta();
  const AMB = [".", "env"].join(""); // arquivo de ambiente (montado para não gravar o literal)
  const ruins = ["/etc/passwd", "../fora.ts", "a/../../b.ts", "src/\0x.ts", "C:\\x\\y.ts", "~/x", AMB, `config/${AMB}.local`, "chave.pem", "keys/id_rsa", "x/segredo.key"];
  it.each(ruins)("map_impact recusa %j", async (c) => {
    expect((await falha(chamar("map_impact", { files: [c] }, porta))).code).toBe("invalid_argument");
  });
  it("map_query/map_evidence recusam target/scope perigosos", async () => {
    for (const t of ["/etc/passwd", "../x", "arq:../x.ts", AMB, "sim:keys/id_rsa#f", "a\0b"]) expect((await falha(chamar("map_query", { kind: "callers", target: t }, porta))).code).toBe("invalid_argument");
    for (const s of ["/abs", "../x", AMB]) expect((await falha(chamar("map_evidence", { topic: "tests", scope: s }, porta))).code).toBe("invalid_argument");
  });
  it("tipos, enums e faixas", async () => {
    const inv = async (tool: NomeMapa, a: unknown): Promise<string> => (await falha(chamar(tool, a, porta))).code;
    expect(await inv("map_query", { kind: "nada" })).toBe("invalid_argument");
    expect(await inv("map_query", {})).toBe("invalid_argument");
    expect(await inv("map_query", { kind: "callers" })).toBe("invalid_argument"); // target obrigatório
    expect(await inv("map_query", { kind: "cycles", depth: 6 })).toBe("invalid_argument");
    expect(await inv("map_query", { kind: "cycles", limit: 0 })).toBe("invalid_argument");
    expect(await inv("map_query", { kind: "cycles", min_confidence: "x" })).toBe("invalid_argument");
    expect(await inv("map_impact", { files: [] })).toBe("invalid_argument");
    expect(await inv("map_impact", { files: Array.from({ length: 51 }, (_, i) => `a${i}.ts`) })).toBe("invalid_argument");
    expect(await inv("map_impact", { files: ["a.ts"], symbols: Array.from({ length: 51 }, () => "a.ts#f") })).toBe("invalid_argument");
    expect(await inv("map_impact", { files: ["a.ts"], symbols: ["../x.ts#f"] })).toBe("invalid_argument");
    expect(await inv("map_evidence", { topic: "x" })).toBe("invalid_argument");
  });
  it("limit > 100 é reduzido a 100 (não recusado) e o padrão é 20", async () => {
    const { porta: p, chamadas } = dublePorta();
    await chamar("map_query", { kind: "cycles", limit: 5000 }, p);
    await chamar("map_query", { kind: "cycles" }, p);
    const qs = chamadas.filter((c) => c.metodo === "query").map((c) => (c.arg as { limit: number }).limit);
    expect(qs).toEqual([100, 20]);
  });
  it("aceita caminho relativo válido e repassa à porta", async () => {
    const { porta: p, chamadas } = dublePorta();
    await chamar("map_impact", { files: ["src/a.ts", "pkg/b.py"], symbols: ["src/a.ts#f"] }, p);
    expect(chamadas.find((c) => c.metodo === "impact")?.arg).toEqual({ files: ["src/a.ts", "pkg/b.py"], symbols: ["src/a.ts#f"] });
  });
});

describe("respostas <= 4 KB", () => {
  it("map_query com 100 itens verbosos é cortado com truncated:true", async () => {
    const grandes = itens(100, "nome-bem-comprido-".repeat(4));
    const r = await chamar("map_query", { kind: "unused", limit: 100 }, dublePorta({ query: async () => ({ items: grandes }) }).porta);
    expect(bytes(r)).toBeLessThanOrEqual(4096);
    expect(r["truncated"]).toBe(true);
    expect(r["items"].length).toBeLessThan(100);
  });
  it("sem excesso não marca truncamento", async () => {
    const r = await chamar("map_query", { kind: "cycles" }, dublePorta().porta);
    expect(r["truncated"]).toBe(false);
    expect(r["items"]).toHaveLength(3);
  });
  it("map_impact com 500 chamadores e map_evidence com 50 fatos cabem", async () => {
    const r = await chamar("map_impact", { files: ["src/a.ts"] }, dublePorta({ impact: async () => impacto(500) }).porta);
    expect(bytes(r)).toBeLessThanOrEqual(4096);
    expect(r["truncated"]).toBe(true);
    expect(r["signals"]).toHaveLength(8);
    expect(r["band"]).toBe("MEDIUM");
    const fatos = Array.from({ length: 50 }, (_, i) => ({ fact: `fato ${i} `.repeat(15), evidence: Array.from({ length: 9 }, (_, j) => `src/f${i}_${j}.ts:${j}`), strength: "MAJORITÁRIO 8/10", counts: { a: 8, b: 2 } }));
    const e = await chamar("map_evidence", { topic: "errors", limit: 50 }, dublePorta({ evidence: async () => ({ facts: fatos }) }).porta);
    expect(bytes(e)).toBeLessThanOrEqual(4096);
    expect(e["truncated"]).toBe(true);
    expect(e["facts"][0].evidence.length).toBeLessThanOrEqual(5);
  });
  it("map_status com milhares de linguagens é cortado", async () => {
    const enorme = Array.from({ length: 5000 }, (_, i) => ({ language: `l${i}`, files: i, loc: i }));
    const r = await chamar("map_status", {}, dublePorta({ status: async () => ({ ...status(), languages: enorme }) }).porta);
    expect(bytes(r)).toBeLessThanOrEqual(4096);
  });
  it("caminho absoluto devolvido pela porta nunca sai; texto com controle/ANSI é saneado", async () => {
    const r = await chamar("map_query", { kind: "cycles" }, dublePorta({ query: async () => ({ items: [{ id: "x", kind: "file", label: "a\u001b[31mb\nc", path: "/Users/x/a.ts", line: 1, confidence: "exact" }] }) }).porta);
    expect(r["items"][0].path).toBeNull();
    expect(r["items"][0].label).toBe("ab c");
  });
  it("map_status devolve o contrato", async () => {
    const r = await chamar("map_status", {}, dublePorta().porta);
    expect(r).toMatchObject({ state: "ready", files: 120, edges: { exact: 300, heuristic: 40 }, stale: false, history: "ok" });
    expect(r["languages"]).toEqual([{ language: "typescript", files: 100, loc: 9000 }]);
  });
});

describe("desempenho da camada da tool", () => {
  it("p95 <= 50 ms com porta falsa", async () => {
    const { porta } = dublePorta({ query: async () => ({ items: itens(100) }) });
    const t: number[] = [];
    for (let i = 0; i < 60; i++) {
      const a = performance.now();
      await chamar("map_query", { kind: "unused", limit: 100 }, porta);
      t.push(performance.now() - a);
    }
    t.sort((x, y) => x - y);
    expect(t[Math.floor(t.length * 0.95)] as number).toBeLessThanOrEqual(50);
  });
});

describe("servidor MCP real + cliente", () => {
  let servidor: ServidorMcp | null = null;
  afterEach(async () => { await servidor?.fechar(); servidor = null; });
  async function conectar(token: string, url: string): Promise<Client> {
    const c = new Client({ name: "teste", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }) as unknown as Transport);
    return c;
  }
  const pedido = { workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_p", role: "piloto" as const, mode: "agentico" as const };

  it("com token `mapa`: lista map_* e chama map_impact; sem ele: ausentes e chamada recusada", async () => {
    const mundo = criarMundo();
    const { porta } = dublePorta();
    mundo.deps.mapa = porta;
    servidor = await iniciarServidorMcp({ deps: mundo.deps, emissor: criarEmissorDeTokens() });
    const c = await conectar(servidor.emitirToken({ ...pedido, mapa: true }), servidor.url);
    const { tools } = await c.listTools();
    for (const t of TOOLS_MAPA) expect(tools.map((x) => x.name)).toContain(t);
    const r = await c.callTool({ name: "map_impact", arguments: { files: ["src/a.ts"] } });
    const corpo = JSON.parse((r.content as Array<{ text: string }>)[0]?.text ?? "");
    expect(corpo).toMatchObject({ band: "MEDIUM", band_worst_case: "HIGH", callers: ["src/c0.ts", "src/c1.ts", "src/c2.ts"] });
    await c.close();

    const c2 = await conectar(servidor.emitirToken(pedido), servidor.url);
    expect((await c2.listTools()).tools.map((x) => x.name)).not.toContain("map_query");
    const r2 = await c2.callTool({ name: "map_query", arguments: { kind: "cycles" } });
    expect(r2.isError).toBe(true);
    expect(JSON.parse((r2.content as Array<{ text: string }>)[0]?.text ?? "")).toMatchObject({ code: "rule_violation", subcode: "forbidden_role" });
    await c2.close();
  });

  it("sem token => 401 (unauthorized)", async () => {
    const mundo = criarMundo();
    servidor = await iniciarServidorMcp({ deps: mundo.deps, emissor: criarEmissorDeTokens() });
    const r = await fetch(servidor.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(r.status).toBe(401);
  });
});
