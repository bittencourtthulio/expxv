import { describe, expect, it } from "vitest";
import { PAINEIS_MAXIMOS_NA_GRADE } from "../../../compartilhado/painel-livre";
import { arvoreEmGrade, caberNaGrade, distribuicaoDaGrade, maximoLegivel } from "./grade-auto";
import { PROFUNDIDADE_MAXIMA, folhas, profundidade } from "./layout";

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `s${i + 1}`);

describe("grade automática", () => {
  it("distribui 1..8 painéis em linhas equilibradas e limita em 8", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => distribuicaoDaGrade(n).join(","))).toEqual(["1", "2", "2,1", "2,2", "3,2", "3,3", "4,3", "4,4"]);
    expect(distribuicaoDaGrade(20)).toEqual([3, 3, 3])
    expect(distribuicaoDaGrade(9)).toEqual([3, 3, 3]);
    expect(distribuicaoDaGrade(0)).toEqual([1]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])("monta a árvore de %i painéis sem perder, duplicar nem reordenar folhas", (n) => {
    const a = arvoreEmGrade(ids(n))!;
    expect(folhas(a)).toEqual(ids(n));
    expect(profundidade(a)).toBeLessThanOrEqual(PROFUNDIDADE_MAXIMA);
    expect(profundidade(a)).toBeLessThanOrEqual(4);
  });

  it("2 painéis ficam lado a lado e 4 viram 2x2", () => {
    expect(arvoreEmGrade(["a", "b"])).toMatchObject({ tipo: "divisao", orientacao: "vertical" });
    expect(arvoreEmGrade(ids(4))).toMatchObject({ tipo: "divisao", orientacao: "horizontal", primeiro: { orientacao: "vertical" }, segundo: { orientacao: "vertical" } });
  });

  it("ignora repetidos, corta no teto e devolve null para lista vazia", () => {
    expect(folhas(arvoreEmGrade(["a", "a", "b"])!)).toEqual(["a", "b"]);
    expect(folhas(arvoreEmGrade(ids(12))!)).toHaveLength(PAINEIS_MAXIMOS_NA_GRADE);
    expect(arvoreEmGrade([])).toBeNull();
  });

  it("máximo legível respeita o mínimo por painel, o piso 2 e o teto", () => {
    expect(maximoLegivel(1440, 800)).toBe(PAINEIS_MAXIMOS_NA_GRADE);
    expect(maximoLegivel(800, 400)).toBe(4);
    expect(maximoLegivel(300, 100)).toBe(2);
    expect(maximoLegivel(0, 0)).toBe(PAINEIS_MAXIMOS_NA_GRADE);
    expect(caberNaGrade(4, 4)).toBe(true);
    expect(caberNaGrade(5, 4)).toBe(false);
  });
});
