import { describe, expect, it } from "vitest";
import { maisPerto } from "./selecao";
import { matrizDaCamera } from "./matematica";

const m = matrizDaCamera({ az: 0, el: 0, raio: 100, centro: [0, 0, 0] }, 800, 600);
const pos = Float32Array.from([0, 0, 0, 20, 0, 0, -20, 0, 0]);

describe("seleção por proximidade", () => {
  it("acha o nó sob o ponteiro e ignora longe demais", () => {
    expect(maisPerto(pos, [1, 1, 1], [1, 1, 1], m, 800, 600, 400, 300)).toBe(0);
    expect(maisPerto(pos, [1, 1, 1], [1, 1, 1], m, 800, 600, 10, 10)).toBe(-1);
  });
  it("não escolhe nó apagado", () => {
    expect(maisPerto(pos, [0, 1, 1], [1, 1, 1], m, 800, 600, 400, 300)).toBe(-1);
  });
  it("o alcance favorece nó grande", () => {
    const a = Float32Array.from([0, 0, 0, 3, 0, 0]);
    expect(maisPerto(a, [1, 1], [1, 0.1], m, 800, 600, 406, 300)).toBe(1);
  });
});
