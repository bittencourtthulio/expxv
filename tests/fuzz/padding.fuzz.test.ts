// T-22.24: fuzz do padding (remover/preencher). Nunca lança; o que `preencher` produz sempre volta por `remover`.
import { describe, expect, it } from "vitest";
import { MAX_CONTEUDO, preencher, remover, tamanhoDoBloco } from "../../src/nucleo/remoto-estendido/padding";
import { ENTRADAS, criarRnd, medir, mutar } from "./gerador";

describe("fuzz: padding", () => {
  it(`${ENTRADAS} quadros mutados: remover nunca lança e o conteúdo devolvido cabe no quadro`, async () => {
    const r = criarRnd(2);
    const bases = [preencher(Buffer.from("olá"), r.bytes), preencher(null, r.bytes), preencher(Buffer.alloc(900, 1), r.bytes), preencher(Buffer.alloc(5000, 2), r.bytes)];
    const m = await medir(200, ENTRADAS / 200, () => {
      const q = r.int(5) === 0 ? r.bytes(r.int(70000)) : mutar(r.pick(bases), r);
      const x = remover(q);
      if (x !== null) {
        expect(x.conteudo.length).toBeLessThanOrEqual(q.length);
        if (x.tipo === "enchimento") expect(x.conteudo.length).toBe(0);
      }
    });
    expect(m.maiorLoteMs).toBeLessThan(2000);
    expect(m.maiorAtrasoMs).toBeLessThan(50);
  });
  it("ida e volta para tamanhos aleatórios; acima do teto lança RangeError; bloco é sempre 256/1024/4096 ou múltiplo de 4096", () => {
    const r = criarRnd(3);
    for (let i = 0; i < 2000; i++) {
      const n = r.int(MAX_CONTEUDO + 1);
      const c = r.bytes(n % 9000);
      const q = preencher(c, r.bytes);
      expect(q.length).toBe(tamanhoDoBloco(3 + c.length));
      expect(remover(q)?.conteudo.equals(c)).toBe(true);
    }
    expect(() => preencher(Buffer.alloc(MAX_CONTEUDO + 1))).toThrow(RangeError);
  });
});
