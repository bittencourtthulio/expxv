import { describe, expect, it } from "vitest";
import { vEndpointHttps, vHost, vInstante, vListaMin, vNumero, vObjetoOpc, vParcial, vPct, vRegistro, vSemCaminhoNemUrl, vVerdadeiro } from "./validar-harness";
import { vTexto } from "./validar";

describe("validar-harness: números e instantes", () => {
  it("vNumero/vPct recusam NaN, Infinity, tipo errado e fora da faixa", () => {
    for (const ruim of [Number.NaN, Infinity, -Infinity, "5", null, undefined, -0.01, 100.01]) expect(vPct(ruim).ok, String(ruim)).toBe(false);
    for (const bom of [0, 100, 42.5]) expect(vPct(bom).ok).toBe(true);
    expect(vNumero({ min: 0, max: 1 })(1.5).ok).toBe(false);
  });
  it("vInstante só aceita ISO UTC", () => {
    expect(vInstante("2026-01-02T03:04:05.006Z").ok).toBe(true);
    expect(vInstante("2026-01-02T03:04:05Z").ok).toBe(true);
    for (const ruim of ["2026-01-02", "2026-13-02T03:04:05Z", "2026-01-02T03:04:05+03:00", 123, null]) expect(vInstante(ruim).ok, String(ruim)).toBe(false);
  });
  it("vVerdadeiro exige true literal", () => {
    expect(vVerdadeiro(true).ok).toBe(true);
    expect(vVerdadeiro(false).ok).toBe(false);
    expect(vVerdadeiro("true").ok).toBe(false);
  });
});

describe("validar-harness: objetos e coleções", () => {
  const v = vObjetoOpc({ a: vTexto({ max: 3 }) }, { b: vTexto({ max: 3 }) });
  it("vObjetoOpc: opcional ausente/undefined vale; campo extra e obrigatório ausente não", () => {
    expect(v({ a: "x" })).toEqual({ ok: true, valor: { a: "x" } });
    expect(v({ a: "x", b: undefined })).toEqual({ ok: true, valor: { a: "x" } });
    expect(v({ a: "x", b: "y" })).toEqual({ ok: true, valor: { a: "x", b: "y" } });
    expect(v({ a: "x", c: 1 }).ok).toBe(false);
    expect(v({ b: "y" }).ok).toBe(false);
    expect(v({ a: "toolong" }).ok).toBe(false);
    expect(v([]).ok).toBe(false);
  });
  it("vListaMin recusa lista curta; vRegistro valida chaves; vParcial recusa chave desconhecida", () => {
    expect(vListaMin(vTexto({ max: 2 }), 1, 3)([]).ok).toBe(false);
    expect(vListaMin(vTexto({ max: 2 }), 1, 3)(["a"]).ok).toBe(true);
    expect(vListaMin(vTexto({ max: 2 }), 1, 3)(["a", "b", "c", "d"]).ok).toBe(false);
    expect(vRegistro(vTexto({ max: 3, padrao: /^[a-z]+$/ }), vTexto({ max: 1 }), 2)({ ab: "x", "A!": "y" }).ok).toBe(false);
    expect(vRegistro(vTexto({ max: 3 }), vTexto({ max: 1 }), 1)({ a: "x", b: "y" }).ok).toBe(false);
    expect(vParcial(["topo", "alto"], vTexto({ max: 2 }))({ topo: "a", medio: "b" }).ok).toBe(false);
    expect(vParcial(["topo", "alto"], vTexto({ max: 2 }))({ topo: "a" })).toEqual({ ok: true, valor: { topo: "a" } });
  });
});

describe("validar-harness: texto de identificação e endpoint", () => {
  const rotulo = vSemCaminhoNemUrl({ min: 1, max: 60 });
  it("recusa URL e caminho em rótulos/nomes", () => {
    for (const ruim of ["https://x.com", "http://a", "www.x.com", "/etc/passwd", "~/x", "C:\\Users", "c:/x", "a/../b", "..\\x", "a\u0000b", "ftp://a"]) expect(rotulo(ruim).ok, ruim).toBe(false);
    for (const bom of ["cl·2", "Conta pessoal", "bug-fix"]) expect(rotulo(bom).ok, bom).toBe(true);
  });
  it("vEndpointHttps: só https, sem credencial, sem fragmento, sem espaço", () => {
    expect(vEndpointHttps("https://api.exemplo.com/v1/decide").ok).toBe(true);
    for (const ruim of ["http://api.exemplo.com", "ftp://x.com", "https://u:p@x.com", "https://x.com/#f", "https://x .com", "x.com", "", "file:///etc/passwd", "javascript:alert(1)"]) {
      expect(vEndpointHttps(ruim).ok, ruim).toBe(false);
    }
    expect(vEndpointHttps(42).ok).toBe(false);
  });
  it("vHost recusa esquema, porta e caminho", () => {
    expect(vHost("openrouter.ai").ok).toBe(true);
    for (const ruim of ["https://openrouter.ai", "openrouter.ai:443", "openrouter.ai/x", "-x.com", ""]) expect(vHost(ruim).ok, ruim).toBe(false);
  });
});
