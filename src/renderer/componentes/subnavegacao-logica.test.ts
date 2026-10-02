import { describe, expect, it } from "vitest";
import { agruparItens, indiceDaTecla, inicialDoRotulo, type ItemSubNav } from "./subnavegacao-logica";

describe("indiceDaTecla", () => {
  it("↓/→ avançam e circulam; ↑/← voltam e circulam", () => {
    expect(indiceDaTecla("ArrowDown", 0, 3)).toBe(1);
    expect(indiceDaTecla("ArrowDown", 2, 3)).toBe(0);
    expect(indiceDaTecla("ArrowRight", 1, 3)).toBe(2);
    expect(indiceDaTecla("ArrowUp", 0, 3)).toBe(2);
    expect(indiceDaTecla("ArrowLeft", 2, 3)).toBe(1);
  });
  it("Home/End vão às pontas; outras teclas e lista vazia não navegam", () => {
    expect(indiceDaTecla("Home", 2, 5)).toBe(0);
    expect(indiceDaTecla("End", 0, 5)).toBe(4);
    expect(indiceDaTecla("Enter", 0, 5)).toBe(-1);
    expect(indiceDaTecla("a", 0, 5)).toBe(-1);
    expect(indiceDaTecla("ArrowDown", 0, 0)).toBe(-1);
  });
});

describe("agruparItens", () => {
  const itens: ItemSubNav[] = [
    { id: "a", rotulo: "A", grupo: "G1" }, { id: "b", rotulo: "B", grupo: "G1" }, { id: "c", rotulo: "C", grupo: "G2" }, { id: "d", rotulo: "D" },
  ];
  it("agrupa consecutivos e preserva o índice global", () => {
    const g = agruparItens(itens);
    expect(g.map((s) => s.titulo)).toEqual(["G1", "G2", null]);
    expect(g.map((s) => s.itens.map((i) => i.indice))).toEqual([[0, 1], [2], [3]]);
  });
  it("sem grupos vira uma só seção sem título", () => {
    const g = agruparItens([{ id: "x", rotulo: "X" }, { id: "y", rotulo: "Y" }]);
    expect(g).toHaveLength(1);
    expect(g[0]?.titulo).toBeNull();
  });
});

it("inicialDoRotulo usa a primeira letra maiúscula", () => {
  expect(inicialDoRotulo("  controle remoto")).toBe("C");
});
