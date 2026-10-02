// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { definirWebgl2ParaTeste, escolherModo, gravarSimples, lerSimples, webgl2Disponivel } from "./suporte";

afterEach(() => { definirWebgl2ParaTeste(null); localStorage.clear(); });

describe("modo do grafo (fallback)", () => {
  it("3D só com WebGL2, sem reduzir movimento e fora do modo simples", () => {
    expect(escolherModo({ webgl2: true, reduzirMovimento: false, simples: false })).toBe("3d");
    expect(escolherModo({ webgl2: false, reduzirMovimento: false, simples: false })).toBe("2d");
    expect(escolherModo({ webgl2: true, reduzirMovimento: true, simples: false })).toBe("2d");
    expect(escolherModo({ webgl2: true, reduzirMovimento: false, simples: true })).toBe("2d");
  });
  it("jsdom não tem WebGL2: a detecção é falsa e o resultado é cacheado", () => {
    expect(webgl2Disponivel()).toBe(false);
    definirWebgl2ParaTeste(true);
    expect(webgl2Disponivel()).toBe(true);
  });
  it("o modo simples persiste", () => {
    expect(lerSimples()).toBe(false);
    gravarSimples(true);
    expect(lerSimples()).toBe(true);
  });
});
