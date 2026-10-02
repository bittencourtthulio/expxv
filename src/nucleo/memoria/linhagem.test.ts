import { afterEach, describe, expect, it } from "vitest";
import type { Banco } from "../banco";
import { NaoEncontradoErro } from "../dominio";
import { novoBancoMemoria, semearPane, semearWorkspace } from "../../../tests/fixtures/memoria/banco";
import { LinhagemCiclicaErro, linhagemDe, raizDaLinhagem } from "./linhagem";

const abertos: Banco[] = [];
const novo = (): Banco => {
  const b = novoBancoMemoria();
  abertos.push(b);
  return b;
};
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

describe("linhagem (T-08.05)", () => {
  it("cadeia de 5: a raiz é a do antepassado mais antigo; sem respawn, o próprio Pane", () => {
    const b = novo();
    const ws = semearWorkspace(b);
    semearPane(b, { id: "p1", ws, estado: "encerrado" });
    for (let i = 2; i <= 5; i++) semearPane(b, { id: `p${i}`, ws, respawn_de: `p${i - 1}`, estado: i === 5 ? "pronto" : "encerrado" });
    expect(linhagemDe(b, "p5")).toEqual(["p5", "p4", "p3", "p2", "p1"]);
    expect(raizDaLinhagem(b, "p5")).toBe("p1");
    expect(raizDaLinhagem(b, "p1")).toBe("p1");
  });
  it("ciclo vira erro nominal; Pane inexistente também", () => {
    const b = novo();
    const ws = semearWorkspace(b);
    semearPane(b, { id: "a", ws, respawn_de: "b", estado: "encerrado" });
    semearPane(b, { id: "b", ws, respawn_de: "a", estado: "encerrado" });
    expect(() => raizDaLinhagem(b, "a")).toThrow(LinhagemCiclicaErro);
    expect(() => raizDaLinhagem(b, "nao_existe")).toThrow(NaoEncontradoErro);
  });
  it("teto de 20 saltos", () => {
    const b = novo();
    const ws = semearWorkspace(b);
    semearPane(b, { id: "n0", ws, estado: "encerrado" });
    for (let i = 1; i <= 25; i++) semearPane(b, { id: `n${i}`, ws, respawn_de: `n${i - 1}`, estado: i === 25 ? "pronto" : "encerrado" });
    expect(() => raizDaLinhagem(b, "n25")).toThrow(LinhagemCiclicaErro);
  });
  it("antepassado removido: a raiz é o último que existe", () => {
    const b = novo();
    const ws = semearWorkspace(b);
    semearPane(b, { id: "x2", ws, respawn_de: "x1_removido" });
    expect(raizDaLinhagem(b, "x2")).toBe("x2");
  });
});
