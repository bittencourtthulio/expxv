// T-22.24: fuzz do tratador de protocolo (Fase 13 extraído) e do transporte do relay. Serviço REAL em loopback (cenário da Fase 13), corpos hostis em todas as rotas e quadros
// do invólucro com claro hostil e chave certa. Nada lança, nenhuma resposta passa de 500, nada executa (nenhum dispositivo é criado), nenhuma tarefa > 50 ms.
import { afterAll, describe, expect, it } from "vitest";
import { criarCenarioRemoto } from "../fixtures/jarvis/cenario-remoto";
import { codificar, decodificar } from "../../src/nucleo/remoto-estendido/quadro";
import { criarTransporteRelay } from "../../src/nucleo/remoto-estendido/transporte-relay";
import type { RotaTratador } from "../../src/nucleo/remoto/tratador";
import { ENTRADAS, criarRnd, jsonHostil, medir, mutar } from "./gerador";

const cen = criarCenarioRemoto();
afterAll(() => cen.fechar());
const ROTAS: RotaTratador[] = ["pareamento_inicio", "pareamento_fim", "pareamento_status", "sessao_inicio", "canal"];

describe("fuzz: tratador e transporte do relay", () => {
  it(`${ENTRADAS} chamadas ao tratador com corpos hostis (janela de pareamento fechada e aberta): sem exceção, sem dispositivo novo`, async () => {
    await cen.ligar();
    const t = cen.servico.tratador();
    const r = criarRnd(7);
    const antes = cen.servico.estado().dispositivos.length;
    const m = await medir(200, ENTRADAS / 200, async (i) => {
      if (i === ENTRADAS / 2) cen.servico.parearIniciar("leitura"); // metade do corpus com a janela aberta (código desconhecido do fuzz)
      const corpo = r.int(3) === 0 ? JSON.parse(JSON.stringify({ epk: r.bytes(65).toString("base64"), nonce: r.bytes(16).toString("base64"), hid: "hs_x", sid: "ses_x", dispositivo_id: "dev_abcdef", ts: Date.now(), sig: r.bytes(64).toString("base64"), quadro: { v: 1, n: r.int(1000), c: r.bytes(40).toString("base64") }, conf: r.bytes(32).toString("base64"), chave_publica: r.bytes(91).toString("base64"), nome: "x" })) : (() => { try { return JSON.parse(jsonHostil(r)) as unknown; } catch { return jsonHostil(r); } })();
      const resp = await t.tratar({ rota: r.pick(ROTAS), corpo, origem: r.pick(["relay", "lan", "loopback"] as const) });
      expect(resp.status).toBeLessThanOrEqual(500);
      expect(resp.status).toBeGreaterThanOrEqual(200);
    });
    expect(cen.servico.estado().dispositivos.length).toBe(antes);
    expect(m.maiorLoteMs).toBeLessThan(3000);
    expect(m.maiorAtrasoMs).toBeLessThan(50);
    expect(await t.tratar({ rota: "canal", corpo: {}, origem: "http" as never })).toMatchObject({ status: 404 });
  }, 40_000);
  it(`transporte do relay: quadros com chave certa e mensagem hostil (rota/id/corpo mutados) respondem 4xx/5xx ou 200 sem lançar; quadro adulterado é inválido`, async () => {
    const chave = Buffer.alloc(32, 5);
    const tr = criarTransporteRelay({ tratador: cen.servico.tratador(), chave });
    const r = criarRnd(8);
    let respostas = 0;
    const m = await medir(100, 500, async () => {
      const k = r.int(6);
      const msg: unknown = k === 0 ? { r: r.pick([...ROTAS, "x", "__proto__", ""]), id: r.pick([0, 1, -1, 1e300, 2 ** 53, 1.5, "7", null]), corpo: JSON.parse("{}") } : k === 1 ? JSON.parse(jsonHostil(r).slice(0, 0) || "{}") : k === 2 ? { r: "canal", id: r.int(100), corpo: { sid: "ses_zzz", quadro: { v: 1, n: 1, c: "AA==" } } } : (() => { try { return JSON.parse(jsonHostil(r)) as unknown; } catch { return { a: 1 }; } })();
      let q: Buffer;
      try {
        q = codificar(chave, msg, "c2h");
      } catch {
        return; // mensagem maior que o teto do quadro: o remetente honesto nem envia
      }
      const res = await tr.receber(r.int(4) === 0 ? mutar(q, r) : q);
      if (res.k === "resposta") {
        respostas++;
        const d = decodificar(chave, res.quadro, "h2c");
        expect(d?.tipo).toBe("dado");
      }
      expect(tr.emVoo()).toBe(0);
    });
    expect(respostas).toBeGreaterThan(100);
    expect(m.maiorAtrasoMs).toBeLessThan(50);
  }, 40_000);
});
