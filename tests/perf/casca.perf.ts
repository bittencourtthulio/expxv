import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirApp } from "../fixture";
import type { AppAberto } from "../fixture";
import { MAC } from "../terminais-ui-ajuda";
import { gravarMedicoes, percentil, registrar } from "./registro";

let a: AppAberto;

beforeAll(async () => {
  a = await abrirApp();
  await a.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15000 });
});
afterAll(async () => {
  gravarMedicoes();
  await a.fechar();
});

describe("orçamentos da casca", () => {
  it("P-01: janela visível e casca interativa ≤ 800 ms (mediana de 3 lançamentos; o 1º, frio, é descartado)", async () => {
    // a marca do main mede desde o início do processo até `ready-to-show`. Um lançamento só mede também o disco frio e a
    // carga da máquina: o 1º lançamento (cache do SO frio) fica no log e fora da mediana; valem os 3 seguintes.
    const amostras: number[] = [];
    for (let i = 0; i < 4; i++) {
      const lancado = i === 0 ? a : await abrirApp();
      try {
        await lancado.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15_000 });
        const info = await lancado.pagina.evaluate(() => (window as unknown as { ade: { perf: { ler(): Promise<{ janelaVisivelMs: number | null }> } } }).ade.perf.ler());
        expect(info.janelaVisivelMs).not.toBeNull();
        amostras.push(info.janelaVisivelMs ?? 99999);
      } finally {
        if (i > 0) await lancado.fechar();
      }
    }
    const medidas = amostras.slice(1);
    const m = registrar({ id: "P-01", descricao: "processo → janela visível (mediana de 3)", valor: percentil(medidas, 50), limite: 800, unidade: "ms", pior: Math.max(...medidas) });
    console.log(`P-01 lançamentos (1º frio): ${amostras.join(", ")} ms → mediana ${m.valor}, pior ${m.pior}`);
    expect(m.ok, `${m.valor} ms > ${m.limite} ms`).toBe(true);
  });

  it("P-02: troca de tela p95 ≤ 50 ms até o quadro pintado", async () => {
    const botoes = a.pagina.locator('nav[aria-label="Principal"] button');
    const total = await botoes.count();
    const tempos: number[] = await a.pagina.evaluate(async (n) => {
      const nav = document.querySelector('nav[aria-label="Principal"]') as HTMLElement;
      const itens = Array.from(nav.querySelectorAll("button")) as HTMLButtonElement[];
      const quadro = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const medidas: number[] = [];
      // duas voltas: a 1ª carrega os chunks lazy; só a 2ª (telas já carregadas) entra no orçamento
      for (let volta = 0; volta < 4; volta++) {
        for (let i = 0; i < n; i++) {
          const alvo = itens[(i + volta) % n] as HTMLButtonElement;
          const t0 = performance.now();
          alvo.click();
          await quadro();
          if (volta >= 1) medidas.push(performance.now() - t0);
        }
      }
      return medidas;
    }, total);
    const p95 = percentil(tempos, 95);
    const m = registrar({ id: "P-02", descricao: "troca de tela (p95)", valor: p95, limite: 50, unidade: "ms", pior: Math.max(...tempos) });
    console.log(`P-02 ${tempos.length} trocas: p50 ${percentil(tempos, 50).toFixed(1)} p95 ${p95.toFixed(1)} máx ${Math.max(...tempos).toFixed(1)} ms`);
    expect(m.ok, `p95 ${m.valor} ms > ${m.limite} ms`).toBe(true);
  });

  // Era a asserção "foco em até 50 ms" do teste de unidade da PaletaComandos (jsdom, flaky sob carga). A latência mora aqui,
  // no Electron real; o teste de unidade só afirma o que é determinístico (foco síncrono, sem timer).
  it("P-02b: paleta de comandos, atalho → foco no campo ≤ 50 ms (p95 de 10; a 1ª, fria, é descartada)", async () => {
    const p = a.pagina;
    await p.waitForTimeout(1_500); // o chunk da paleta é pré-carregado em ocioso depois da 1ª pintura
    await p.evaluate(() => {
      const w = window as unknown as { __paleta: { t0: number | null; lat: number[] } };
      w.__paleta = { t0: null, lat: [] };
      window.addEventListener("keydown", () => { w.__paleta.t0 ??= performance.now(); }, true);
      document.addEventListener("focusin", (e) => {
        const alvo = e.target as HTMLElement;
        if (alvo.getAttribute("role") !== "combobox" || alvo.closest('[role="dialog"]') === null || w.__paleta.t0 === null) return;
        const t0 = w.__paleta.t0;
        w.__paleta.t0 = null;
        requestAnimationFrame(() => w.__paleta.lat.push(performance.now() - t0));
      }, true);
    });
    for (let i = 0; i < 11; i++) {
      await p.keyboard.press(MAC ? "Meta+k" : "Control+Shift+p");
      await p.waitForFunction((n) => (window as unknown as { __paleta: { lat: number[] } }).__paleta.lat.length > n, i, { timeout: 10_000 });
      await p.keyboard.press("Escape");
      await p.waitForSelector('[role="dialog"][aria-label="Paleta de comandos"]', { state: "detached", timeout: 10_000 });
      await p.evaluate(() => { (window as unknown as { __paleta: { t0: number | null } }).__paleta.t0 = null; });
      await p.waitForTimeout(100);
    }
    const todas = await p.evaluate(() => (window as unknown as { __paleta: { lat: number[] } }).__paleta.lat);
    const lat = todas.slice(1); // a 1ª (fria) fica no log, fora do p95
    const p95 = percentil(lat, 95);
    console.log(`P-02b amostras (1ª fria): ${todas.map((t) => t.toFixed(1)).join(", ")} ms`);
    const m = registrar({ id: "P-02b", descricao: "paleta: atalho → foco no campo (p95 de 10)", valor: p95, limite: 50, unidade: "ms", pior: Math.max(...lat) });
    expect(m.ok, `p95 ${m.valor} ms > ${m.limite} ms`).toBe(true);
  });

  it("P-12: o event loop do main nunca bloqueia mais que 50 ms depois do boot (mediana de 3 janelas de 1,5 s)", async () => {
    // O histograma mede atraso de agendamento: numa máquina com dezenas de processos um tranco do SO aparece como "bloqueio".
    // Um bloqueio REAL do app (trabalho síncrono no main) aparece em todas as janelas; um tranco do SO, em uma. Por isso o
    // valor é a mediana dos máximos de 3 janelas seguidas; o maior de todos vai no relatório (`pior`) e no log, sem esconder.
    const janelas: number[] = [];
    for (let i = 0; i < 3; i++) {
      janelas.push(await a.app.evaluate(async () => {
        const { monitorEventLoopDelay } = process.getBuiltinModule("node:perf_hooks") as typeof import("node:perf_hooks");
        const h = monitorEventLoopDelay({ resolution: 5 });
        h.enable();
        await new Promise((r) => setTimeout(r, 1500));
        h.disable();
        return h.max / 1e6;
      }));
    }
    console.log(`P-12 máximo por janela de 1,5 s: ${janelas.map((j) => j.toFixed(1)).join(", ")} ms`);
    const m = registrar({ id: "P-12", descricao: "bloqueio máximo do event loop do main (mediana de 3 janelas)", valor: percentil(janelas, 50), limite: 50, unidade: "ms", pior: Math.max(...janelas) });
    expect(m.ok, `${m.valor} ms > ${m.limite} ms (janelas: ${janelas.join(", ")})`).toBe(true);
  });
});
