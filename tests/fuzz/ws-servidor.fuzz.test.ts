// T-22.24 (achado da auditoria própria): fuzz determinístico do LEITOR de quadros WebSocket do relay (`criarLeitor`), a primeira coisa que toca bytes hostis. 200 000 entradas, sem exceção,
// nenhum evento maior que o limite consultado, nenhum quadro de dados maior que o limite entregue, e depois de um `erro` o leitor não devolve mais nada.
import { describe, expect, it } from "vitest";
import { criarLeitor, type EventoWs } from "../../src/nucleo/relay/ws-servidor";
import { ENTRADAS, criarRnd, medir, mutar } from "./gerador";

/** quadro de CLIENTE válido (mascarado) para servir de base das mutações. */
function quadroCliente(op: number, dados: Buffer, mascara = Buffer.from([1, 2, 3, 4])): Buffer {
  const n = dados.length;
  const cab = n < 126 ? Buffer.from([0x80 | op, 0x80 | n]) : Buffer.from([0x80 | op, 0x80 | 126, n >> 8, n & 255]);
  const corpo = Buffer.alloc(n);
  for (let i = 0; i < n; i++) corpo[i] = (dados[i] as number) ^ (mascara[i % 4] as number);
  return Buffer.concat([cab, mascara, corpo]);
}

describe("fuzz: leitor de quadros WebSocket do relay", () => {
  it(`${ENTRADAS} entradas: nunca lança, respeita o limite por quadro, para depois do primeiro erro e não segura memória`, async () => {
    const r = criarRnd(7);
    const bases = [quadroCliente(1, Buffer.from('{"t":"ping"}')), quadroCliente(2, Buffer.alloc(300, 9)), quadroCliente(9, Buffer.from("x")), quadroCliente(8, Buffer.from([3, 232])), quadroCliente(2, Buffer.alloc(1000, 1))];
    let comErro = 0;
    const m = await medir(200, ENTRADAS / 200, () => {
      const limite = r.pick([1024, 65536, 16, 125]);
      const leitor = criarLeitor(() => limite);
      const entrada = r.int(4) === 0 ? r.bytes(r.int(3000)) : mutar(Buffer.concat([r.pick(bases), r.pick(bases)]), r);
      // alimenta em pedaços aleatórios (o TCP fragmenta como quiser)
      const eventos: EventoWs[] = [];
      let i = 0;
      while (i < entrada.length) {
        const n = 1 + r.int(Math.max(1, entrada.length - i));
        eventos.push(...leitor.alimentar(entrada.subarray(i, i + n)));
        i += n;
      }
      let falhou = false;
      for (const e of eventos) {
        if ("erro" in e) {
          falhou = true;
          comErro++;
          expect([1002, 1003, 1009]).toContain(e.erro);
        } else {
          expect(falhou, "evento depois de um erro").toBe(false);
          if (e.op === "texto" || e.op === "binario") expect(e.dados.length).toBeLessThanOrEqual(limite);
          else expect(e.dados.length).toBeLessThanOrEqual(125);
        }
      }
      if (falhou) expect(leitor.alimentar(r.pick(bases))).toEqual([]); // depois do erro, nada mais
    });
    expect(m.maiorLoteMs).toBeLessThan(2000); // 1 000 entradas por lote
    expect(m.maiorAtrasoMs).toBeLessThan(50);
    expect(m.heapMb).toBeLessThan(128); // o corpus aloca milhões de Buffers pequenos: o que importa é não reter (sem vazamento linear), não o pico do coletor
    expect(comErro).toBeGreaterThan(1000); // o corpus realmente provoca erros de protocolo
  }, 60_000);
});
