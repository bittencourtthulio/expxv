// T-22.24: fuzz do invólucro do relay (decodificar/abrir). Criptografia real: o corpus são quadros AUTÊNTICOS mutados (rejeitados pela tag) + lixo; um subconjunto
// tem a tag refeita sobre claro hostil (padding/JSON inválido), para exercitar `remover` e `JSON.parse` depois da abertura. Nunca lança.
import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aadEnvelope, abrir, codificar, codificarEnchimento, decodificar } from "../../src/nucleo/remoto-estendido/quadro";
import { ENTRADAS, criarRnd, jsonHostil, medir, mutar } from "./gerador";

const chave = Buffer.alloc(32, 9);
const selarCru = (claro: Buffer, r: ReturnType<typeof criarRnd>): Buffer => {
  const iv = r.bytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  c.setAAD(aadEnvelope("c2h"));
  return Buffer.concat([iv, c.update(claro), c.final(), c.getAuthTag()]);
};

describe("fuzz: quadro do invólucro", () => {
  it(`${ENTRADAS} entradas: nunca lança; mutação de quadro autêntico nunca abre; claro hostil com tag válida é recusado ou JSON`, async () => {
    const r = criarRnd(4);
    const bases = [codificar(chave, { id: 1, r: "canal", corpo: { x: 1 } }, "c2h"), codificarEnchimento(chave, "c2h"), codificar(chave, { a: "é".repeat(2000) }, "c2h")];
    let abriu = 0;
    const m = await medir(200, ENTRADAS / 200, () => {
      const k = r.int(20);
      let q: Buffer;
      if (k === 0) q = selarCru(Buffer.concat([Buffer.from([r.int(3)]), r.bytes(r.int(600))]), r);
      else if (k === 1) q = selarCru(Buffer.from(jsonHostil(r)), r);
      else if (k < 4) q = r.bytes(r.int(5000));
      else q = mutar(r.pick(bases), r);
      const igualBase = bases.some((b) => b.equals(q));
      const x = decodificar(chave, q, r.int(2) === 0 ? "c2h" : "h2c");
      if (x !== null) abriu++;
      expect(abrir(chave, q, "h2c")).toBeNull(); // direção trocada nunca abre (AAD)
      if (!igualBase && k >= 4) expect(decodificar(chave, q, "c2h")).toBeNull();
    });
    expect(abriu).toBeGreaterThan(0);
    expect(m.maiorLoteMs).toBeLessThan(3000);
    expect(m.maiorAtrasoMs).toBeLessThan(50);
    expect(m.heapMb).toBeLessThan(96);
  }, 30_000);
  it("quadros curtos, vazios e com tamanho impossível retornam null", () => {
    for (const n of [0, 1, 11, 27, 28, 30, 70_000]) expect(decodificar(chave, randomBytes(n), "c2h")).toBeNull();
  });
});
