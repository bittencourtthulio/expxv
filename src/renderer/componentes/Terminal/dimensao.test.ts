import { describe, expect, it } from "vitest";
import { bytesDoChunk, deveAplicarDimensao } from "./dimensao";

describe("deveAplicarDimensao", () => {
  it("aplica na primeira medida válida e quando colunas ou linhas mudam", () => {
    expect(deveAplicarDimensao(null, 80, 24)).toBe(true);
    expect(deveAplicarDimensao({ colunas: 80, linhas: 24 }, 100, 24)).toBe(true);
    expect(deveAplicarDimensao({ colunas: 80, linhas: 24 }, 80, 30)).toBe(true);
  });
  it("não aplica medida igual nem inválida", () => {
    expect(deveAplicarDimensao({ colunas: 80, linhas: 24 }, 80, 24)).toBe(false);
    expect(deveAplicarDimensao(null, 1, 24)).toBe(false);
    expect(deveAplicarDimensao(null, 80, 0)).toBe(false);
  });
});

describe("bytesDoChunk", () => {
  it("conta bytes UTF-8, não caracteres", () => {
    expect(bytesDoChunk("abc")).toBe(3);
    expect(bytesDoChunk("é")).toBe(2);
    expect(bytesDoChunk("😀")).toBe(4);
    expect(bytesDoChunk("")).toBe(0);
  });
});
