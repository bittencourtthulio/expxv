import { describe, expect, it } from "vitest";
import { atribuirTokens, lerTema, paraRgb, resolverPaleta, TOKENS_CATEGORIA } from "./cores";

const TOKENS: Record<string, string> = { "--fundo": "#16181a", "--texto": "#f2f5f3", "--destaque": "#2563eb", "--alerta": "#ff0000", "--grafico-1": "#102030", "--grafico-3": "rgb(0, 255, 0)", "--texto-discreto": "#888888" };
const ler = (n: string): string => TOKENS[n] ?? "";

describe("cores do grafo 3D", () => {
  it("converte hex curto/longo e rgb; valor desconhecido cai no padrão", () => {
    expect(paraRgb("#fff")).toEqual([1, 1, 1]);
    expect(paraRgb("#ff0000")[0]).toBe(1);
    expect(paraRgb("rgb(0, 255, 0)")).toEqual([0, 1, 0]);
    expect(paraRgb("rgba(255 0 0 / 0.5)")[0]).toBe(1);
    expect(paraRgb("azul", [0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
    expect(paraRgb("#zzzzzz", [0, 0, 0])).toEqual([0, 0, 0]);
  });
  it("atribui tokens em rodízio, respeitando as cores fixas (com ou sem var())", () => {
    const m = atribuirTokens(["a", "b", "c", "x", "y"], { x: "var(--alerta)", y: "--destaque" });
    expect(m.get("a")).toBe(TOKENS_CATEGORIA[0]); expect(m.get("b")).toBe(TOKENS_CATEGORIA[1]); expect(m.get("c")).toBe(TOKENS_CATEGORIA[2]);
    expect(m.get("x")).toBe("--alerta"); expect(m.get("y")).toBe("--destaque");
  });
  it("rodízio dá a volta quando há mais categorias que tokens", () => {
    const cats = Array.from({ length: TOKENS_CATEGORIA.length + 2 }, (_, i) => "c" + i);
    expect(atribuirTokens(cats, {}).get("c" + TOKENS_CATEGORIA.length)).toBe(TOKENS_CATEGORIA[0]);
  });
  it("resolve a paleta lendo as variáveis do tema", () => {
    const p = resolverPaleta(["a", "b"], {}, ler);
    expect(p.get("b")).toEqual([0, 1, 0]);
    expect(p.get("a")?.[2]).toBeCloseTo(0x30 / 255, 5);
  });
  it("detecta tema claro pelo fundo", () => {
    expect(lerTema(ler).claro).toBe(false);
    expect(lerTema((n) => (n === "--fundo" ? "#f5f6f4" : ler(n))).claro).toBe(true);
  });
});
