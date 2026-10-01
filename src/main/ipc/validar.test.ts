import { describe, expect, it } from "vitest";
import { vBooleano, vEnum, vInteiro, vJson, vLista, vObjeto, vTexto, vVazio } from "./validar";

describe("validadores primitivos", () => {
  it("vVazio aceita só undefined", () => {
    expect(vVazio(undefined).ok).toBe(true);
    expect(vVazio(null).ok).toBe(false);
    expect(vVazio({}).ok).toBe(false);
  });

  it("vTexto respeita tipo, tamanho e padrão", () => {
    const v = vTexto({ min: 2, max: 5, padrao: /^[a-z]+$/ });
    expect(v("abc")).toEqual({ ok: true, valor: "abc" });
    expect(v("a").ok).toBe(false);
    expect(v("abcdef").ok).toBe(false);
    expect(v("AB1").ok).toBe(false);
    expect(v(1).ok).toBe(false);
  });

  it("vInteiro e vEnum e vBooleano", () => {
    expect(vInteiro({ min: 1, max: 3 })(2).ok).toBe(true);
    expect(vInteiro({ min: 1, max: 3 })(2.5).ok).toBe(false);
    expect(vInteiro({ min: 1, max: 3 })(4).ok).toBe(false);
    expect(vEnum(["a", "b"] as const)("a").ok).toBe(true);
    expect(vEnum(["a", "b"] as const)("c").ok).toBe(false);
    expect(vBooleano(true).ok).toBe(true);
    expect(vBooleano("true").ok).toBe(false);
  });

  it("vJson limita o tamanho serializado e recusa o que não serializa", () => {
    expect(vJson(10)({ a: 1 }).ok).toBe(true);
    expect(vJson(10)({ a: "x".repeat(50) }).ok).toBe(false);
    expect(vJson(100)(undefined).ok).toBe(false);
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(vJson(100)(circular).ok).toBe(false);
  });
});

describe("vObjeto estrito e vLista", () => {
  const v = vObjeto({ nome: vTexto({ max: 10 }), n: vInteiro({ min: 0, max: 9 }) });

  it("reconstrói o objeto e rejeita campo extra, ausente ou inválido", () => {
    expect(v({ nome: "x", n: 1 })).toEqual({ ok: true, valor: { nome: "x", n: 1 } });
    expect(v({ nome: "x", n: 1, extra: true }).ok).toBe(false);
    expect(v({ nome: "x" }).ok).toBe(false);
    expect(v({ nome: 1, n: 1 }).ok).toBe(false);
    expect(v(null).ok).toBe(false);
    expect(v([]).ok).toBe(false);
  });

  it("vLista valida cada item e limita o tamanho", () => {
    const l = vLista(vInteiro({ min: 0, max: 9 }), 2);
    expect(l([1, 2])).toEqual({ ok: true, valor: [1, 2] });
    expect(l([1, 2, 3]).ok).toBe(false);
    expect(l([1, 99]).ok).toBe(false);
    expect(l("x").ok).toBe(false);
  });
});
