import { afterEach, describe, expect, it } from "vitest";
import { LIMITE_WEBGL, contextosWebglEmUso, escolherWebgl, liberarContextoWebgl, reservarContextoWebgl, zerarContextosWebgl } from "./webgl";

afterEach(zerarContextosWebgl);

describe("escolherWebgl", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `s${i}`);
  it("nunca passa de 6 painéis e sempre inclui o painel em foco", () => {
    const escolhidos = escolherWebgl(ids, "s11");
    expect(escolhidos.size).toBe(LIMITE_WEBGL);
    expect(escolhidos.has("s11")).toBe(true);
    expect(escolherWebgl(ids, null).size).toBe(6);
  });
  it("com poucos painéis todos usam WebGL; foco fora de vista é ignorado", () => {
    expect([...escolherWebgl(["a", "b"], "z")]).toEqual(["a", "b"]);
    expect(escolherWebgl([], null).size).toBe(0);
  });
});

describe("contagem de contextos WebGL", () => {
  it("a 7ª reserva é recusada e liberar devolve a vaga", () => {
    for (let i = 0; i < 6; i += 1) expect(reservarContextoWebgl()).toBe(true);
    expect(reservarContextoWebgl()).toBe(false);
    expect(contextosWebglEmUso()).toBe(6);
    liberarContextoWebgl();
    expect(reservarContextoWebgl()).toBe(true);
    expect(contextosWebglEmUso()).toBeLessThanOrEqual(6);
  });
  it("liberar além do que foi reservado não deixa a contagem negativa", () => {
    liberarContextoWebgl();
    expect(contextosWebglEmUso()).toBe(0);
  });
});
