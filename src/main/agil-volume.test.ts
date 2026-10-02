// Volume (5 000 tasks) com SQLite real: o main nunca fica preso em um trecho longo (lotes), o painel e a lista continuam dentro do orçamento e a sincronização
// seguinte (sem mudança) é barata. Limites aqui são folgados (CI); os orçamentos oficiais vivem em tests/perf.
import { afterEach, describe, expect, it } from "vitest";
import { gerarVolumeAgil, WS } from "../../tests/fixtures/agil/gerar";
import { montarAgil, type MontagemAgil } from "../../tests/fixtures/agil/montagem-main";
import type { FonteTrabalho } from "../nucleo/agil/portas";

const abertos: MontagemAgil[] = [];
afterEach(() => abertos.splice(0).forEach((m) => m.fechar()));

describe("volume: 200 trabalhos x 25 tasks", () => {
  it("sincroniza em lotes curtos, lista e pinta o painel dentro do orçamento", async () => {
    const fontes: FonteTrabalho[] = gerarVolumeAgil({ trabalhos: 200, tasksPorTrabalho: 25 });
    const metodo = { fontes: async () => fontes, ocorrencias: async () => [], historicoSprintx: async () => null, esquecer: () => undefined, bloqueiosAbertos: () => 0 };
    const m = montarAgil({ workspaces: [WS], metodo });
    abertos.push(m);
    // observa o maior tempo SEM ceder o event loop durante a sincronização
    let maiorPausa = 0;
    let ultimo = performance.now();
    const timer = setInterval(() => { const t = performance.now(); maiorPausa = Math.max(maiorPausa, t - ultimo); ultimo = t; }, 1);
    const t0 = performance.now();
    m.servico.sincronizar(WS);
    await m.servico.aguardarSincronizacao(WS);
    const total = performance.now() - t0;
    clearInterval(timer);
    const met = m.servico.metricas();
    // eslint-disable-next-line no-console
    console.log(`[agil-volume] ${JSON.stringify(met)}`);
    // eslint-disable-next-line no-console
    console.log(`[agil-volume] sync total ${total.toFixed(0)} ms, lotes ${String(met["lotes"])}, maior lote ${String(met["maior_lote_ms"])} ms, maior pausa do event loop ${maiorPausa.toFixed(1)} ms`);
    expect((await m.servico.estado(WS)).base.tasks).toBe(5000);
    expect(met["lotes"]).toBeGreaterThanOrEqual(5000 / 400);
    expect(met["maior_lote_ms"] as number).toBeLessThan(150);

    const t1 = performance.now();
    const pg = m.servico.backlogListar(WS, { limite: 100 });
    const tLista = performance.now() - t1;
    const t2 = performance.now();
    const p = m.servico.painel(WS);
    const tPainel = performance.now() - t2;
    const t3 = performance.now();
    m.servico.painel(WS);
    const tCache = performance.now() - t3;
    // eslint-disable-next-line no-console
    console.log(`[agil-volume] lista ${tLista.toFixed(0)} ms, painel ${tPainel.toFixed(0)} ms, painel (cache) ${tCache.toFixed(1)} ms`);
    expect(pg.total).toBe(5000);
    expect(p.base.tasks).toBe(5000);
    expect(tLista).toBeLessThan(400);
    expect(tPainel).toBeLessThan(1500);
    expect(tCache).toBeLessThan(20);

    // segunda sincronização sem mudança: nada reprocessa
    const lotes = met["lotes"];
    const t4 = performance.now();
    m.servico.sincronizar(WS);
    await m.servico.aguardarSincronizacao(WS);
    const t5 = performance.now() - t4;
    // eslint-disable-next-line no-console
    console.log(`[agil-volume] sync sem mudança ${t5.toFixed(0)} ms`);
    expect(m.servico.metricas()["lotes"]).toBe(lotes);
  }, 120_000);
});
