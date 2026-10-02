import { describe, expect, it } from "vitest";
import { FILTROS_VAZIOS, filtrosVazios, gravarFiltros, lerFiltros, sanearFiltros, type ArmazemLike } from "./board-filtros";

const armazem = (): ArmazemLike & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

describe("filtros do board", () => {
  it("sanear descarta campo desconhecido, coluna inválida e tipo errado", () => {
    const f = sanearFiltros({ colunas: ["a_fazer", "x"], selos: ["pronta", 3], busca: 5, modelo: "m", intruso: 1, agrupar: "fase", trabalho_ids: ["a", 2] });
    expect(f).toEqual({ colunas: ["a_fazer"], selos: ["pronta"], modelo: "m", agrupar: "fase", trabalho_ids: ["a"] });
    expect(sanearFiltros("lixo")).toEqual(FILTROS_VAZIOS);
  });
  it("grava por workspace, limpar remove e storage quebrado não derruba", () => {
    const a = armazem();
    gravarFiltros("w1", { agrupar: "trabalho", busca: "x" }, a);
    expect(lerFiltros("w1", a).busca).toBe("x");
    expect(lerFiltros("w2", a)).toEqual(FILTROS_VAZIOS);
    gravarFiltros("w1", { ...FILTROS_VAZIOS }, a);
    expect(a.m.size).toBe(0);
    const quebrado: ArmazemLike = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(lerFiltros("w1", quebrado)).toEqual(FILTROS_VAZIOS);
    expect(() => gravarFiltros("w1", { busca: "a" }, quebrado)).not.toThrow();
    expect(lerFiltros("w1", null)).toEqual(FILTROS_VAZIOS);
  });
  it("filtrosVazios", () => {
    expect(filtrosVazios(FILTROS_VAZIOS)).toBe(true);
    expect(filtrosVazios({ com_custo: false })).toBe(false);
  });
});
