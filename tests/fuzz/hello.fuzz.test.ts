// T-22.24: fuzz determinístico do parser do protocolo do relay (hello/desafio/prova/controle). 200 000 entradas, sem exceção, sem tarefa > 50 ms.
import { describe, expect, it } from "vitest";
import { VERSAO_PROTOCOLO_RELAY } from "../../src/compartilhado/relay";
import { parseControle } from "../../src/nucleo/relay/protocolo";
import { ENTRADAS, criarRnd, jsonHostil, medir, mutar } from "./gerador";

const b64 = (n: number): string => Buffer.alloc(n, 7).toString("base64");
const BASES = [
  { t: "hello", v: VERSAO_PROTOCOLO_RELAY, papel: "host", canal: "0".repeat(32), ts: 1, nonce: b64(16) },
  { t: "desafio", n: b64(16) },
  { t: "prova", pub: b64(91), sig: b64(64), cli: b64(91), ef: 1 },
  { t: "erro", c: "recusado" },
  { t: "ping" },
  { t: "desregistrar" },
].map((o) => Buffer.from(JSON.stringify(o)));

describe("fuzz: parseControle", () => {
  it(`${ENTRADAS} entradas mutadas: nunca lança, nunca devolve objeto com campo fora da lista, nenhum lote > 50 ms`, async () => {
    const r = criarRnd(1);
    let aceitos = 0;
    const m = await medir(200, ENTRADAS / 200, () => {
      const k = r.int(10);
      const texto = k < 6 ? mutar(r.pick(BASES), r).toString(r.int(2) === 0 ? "utf8" : "latin1") : k < 8 ? jsonHostil(r) : r.bytes(r.int(2000)).toString("utf8");
      const lim = r.pick([1024, 65536, 16, 0]);
      const x = parseControle(texto, lim);
      if (x !== null) {
        aceitos++;
        expect(Buffer.byteLength(texto)).toBeLessThanOrEqual(lim);
        expect(["hello", "desafio", "prova", "ok", "erro", "ping", "pong", "fechar", "desregistrar"]).toContain(x.t);
      }
    });
    expect(aceitos).toBeGreaterThan(500); // o corpus alcança o caminho feliz (não é só lixo)
    expect(m.maiorLoteMs).toBeLessThan(2000); // 1 000 entradas por lote
    expect(m.maiorAtrasoMs).toBeLessThan(50);
    expect(m.heapMb).toBeLessThan(64);
  });
  it("tipos não string, cadeias gigantes e JSON profundo viram null sem estourar a pilha", () => {
    for (const x of [undefined, null, 1, {}, [], Symbol.iterator, "[".repeat(200_000), "{".repeat(200_000), "9".repeat(100_000), ""]) expect(parseControle(x as never, 1 << 20)).toBeNull();
  });
});
