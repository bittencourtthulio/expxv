import { describe, expect, it } from "vitest";
import { proximaPosicao } from "./foco";

describe("navegação por setas", () => {
  const t = [3, 0, 2, 5, 0, 1];
  it("vertical respeita os limites", () => {
    expect(proximaPosicao({ coluna: 0, indice: 0 }, "ArrowUp", t)).toEqual({ coluna: 0, indice: 0 });
    expect(proximaPosicao({ coluna: 0, indice: 2 }, "ArrowDown", t)).toEqual({ coluna: 0, indice: 2 });
    expect(proximaPosicao({ coluna: 3, indice: 1 }, "End", t)).toEqual({ coluna: 3, indice: 4 });
    expect(proximaPosicao({ coluna: 3, indice: 3 }, "Home", t)).toEqual({ coluna: 3, indice: 0 });
  });
  it("horizontal pula colunas vazias e prende o índice ao tamanho", () => {
    expect(proximaPosicao({ coluna: 0, indice: 2 }, "ArrowRight", t)).toEqual({ coluna: 2, indice: 1 });
    expect(proximaPosicao({ coluna: 3, indice: 4 }, "ArrowRight", t)).toEqual({ coluna: 5, indice: 0 });
    expect(proximaPosicao({ coluna: 5, indice: 0 }, "ArrowRight", t)).toEqual({ coluna: 5, indice: 0 });
    expect(proximaPosicao({ coluna: 2, indice: 0 }, "ArrowLeft", t)).toEqual({ coluna: 0, indice: 0 });
  });
});
