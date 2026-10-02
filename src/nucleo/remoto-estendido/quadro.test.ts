import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { abrir, codificar, decodificar, selar } from "./quadro";

describe("invólucro dos quadros do relay (T-22.10)", () => {
  const k = randomBytes(32);
  it("ida e volta; direção trocada, chave errada e adulteração de qualquer byte falham (null, sem lançar)", () => {
    const q = codificar(k, { t: "ping", n: 1 }, "c2h");
    expect(decodificar(k, q, "c2h")).toMatchObject({ tipo: "dado", mensagem: { t: "ping", n: 1 } });
    expect(decodificar(k, q, "h2c")).toBeNull(); // quadro refletido
    expect(decodificar(randomBytes(32), q, "c2h")).toBeNull();
    for (const i of [0, 5, 12, 40, 100, q.length - 1]) {
      const x = Buffer.from(q);
      x[i] = (x[i] as number) ^ 1;
      expect(decodificar(k, x, "c2h"), `byte ${i}`).toBeNull();
    }
    expect(decodificar(k, q.subarray(0, q.length - 1), "c2h")).toBeNull();
    for (let i = 0; i < 500; i++) expect(() => decodificar(k, randomBytes(i % 300), "c2h")).not.toThrow();
  });
  it("conteúdo que não é JSON ou que não tem padding válido é recusado", () => {
    const naoJson = selar(k, Buffer.concat([Buffer.from([0, 0, 3]), Buffer.from("{{{"), Buffer.alloc(250)]), "c2h");
    expect(decodificar(k, naoJson, "c2h")).toBeNull();
    expect(abrir(k, selar(k, Buffer.from("curto"), "c2h"), "c2h")?.toString()).toBe("curto");
    expect(decodificar(k, selar(k, Buffer.from("sem formato de padding"), "c2h"), "c2h")).toBeNull();
  });
});
