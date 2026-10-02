import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_CONTEUDO, preencher, remover, SOBRECARGA_ENVELOPE, tamanhoDoBloco } from "./padding";
import { codificar, codificarEnchimento, decodificar } from "./quadro";

describe("padding de quadros (T-22.09)", () => {
  it("blocos de 256 B, 1 KiB e 4 KiB; acima, múltiplos de 4 KiB", () => {
    expect([1, 100, 253, 254].map(tamanhoDoBloco)).toEqual([256, 256, 256, 256]);
    expect([257, 1000, 1024].map(tamanhoDoBloco)).toEqual([1024, 1024, 1024]);
    expect([1025, 4096].map(tamanhoDoBloco)).toEqual([4096, 4096]);
    expect([4097, 8192, 8193].map(tamanhoDoBloco)).toEqual([8192, 8192, 12288]);
  });
  it("ida e volta preserva o conteúdo; enchimento é reconhecido; quadros inválidos nunca lançam", () => {
    for (const n of [0, 1, 200, 253, 254, 255, 1000, 5000, MAX_CONTEUDO]) {
      const c = randomBytes(n);
      const q = preencher(c);
      expect(q.length).toBe(tamanhoDoBloco(3 + n));
      const r = remover(q);
      expect(r?.tipo).toBe("dado");
      expect(Buffer.compare(r?.conteudo ?? Buffer.alloc(0), c)).toBe(0);
    }
    expect(remover(preencher(null))?.tipo).toBe("enchimento");
    expect(() => preencher(randomBytes(MAX_CONTEUDO + 1))).toThrow();
    for (let i = 0; i < 2000; i++) expect(() => remover(randomBytes(i % 700))).not.toThrow();
    const ruim = preencher(randomBytes(10));
    ruim[1] = 255; // comprimento absurdo
    expect(remover(ruim)).toBeNull();
    expect(remover(Buffer.concat([preencher(randomBytes(10)), Buffer.alloc(1)]))).toBeNull(); // fora do bloco
  });
  it("o maior quadro selado cabe no teto de 64 KiB do relay", () => {
    const k = randomBytes(32);
    const q = codificar(k, { x: "a".repeat(MAX_CONTEUDO - 10) }, "h2c");
    expect(q.length).toBeLessThanOrEqual(64 * 1024);
  });
  it("ax08_padding_de_quadros: comandos de tamanhos diferentes no mesmo bloco são indistinguíveis por tamanho; enchimento idem; sobrecarga ≤ 64 B + bloco", () => {
    const k = randomBytes(32);
    const curto = codificar(k, { t: "comando", texto: "status" }, "c2h");
    const medio = codificar(k, { t: "comando", texto: "x".repeat(150) }, "c2h");
    const filler = codificarEnchimento(k, "c2h");
    expect(curto.length).toBe(medio.length);
    expect(curto.length).toBe(filler.length);
    expect(curto.length).toBe(256 + SOBRECARGA_ENVELOPE);
    const grande = codificar(k, { t: "comando", texto: "y".repeat(2000) }, "c2h");
    expect(grande.length).toBe(4096 + SOBRECARGA_ENVELOPE);
    // sobrecarga por mensagem além do bloco: só o invólucro (28 B ≤ 64 B)
    expect(SOBRECARGA_ENVELOPE).toBeLessThanOrEqual(64);
    // mesmo conteúdo cifrado duas vezes nunca repete bytes (nonce aleatório)
    expect(codificar(k, { a: 1 }, "c2h").equals(codificar(k, { a: 1 }, "c2h"))).toBe(false);
    expect(decodificar(k, filler, "c2h")?.tipo).toBe("enchimento");
    expect(decodificar(k, curto, "c2h")).toMatchObject({ tipo: "dado", mensagem: { t: "comando", texto: "status" } });
  });
});
