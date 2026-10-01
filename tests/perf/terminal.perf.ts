// Orçamentos dos terminais (03-ORCAMENTOS-DESEMPENHO.md): P-03, P-04, P-05, P-06, P-07 e P-13.
// Electron real, CLI falsa (tests/fixtures/cli-pty.mjs), tudo pela UI (cliques/teclado). Os valores vão para
// docs/ade/perf/ultimo.json por `registrar`/`gravarMedicoes`. Nunca se relaxa limite.
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import type { AppAberto } from "../fixture";
import { abrir, atalho, criarAmbiente, digitarLinha, esperarBuffer, focarPainel, idsDosPaineis, irParaTerminais, prepararPrimeiraSessao } from "../terminais-ui-ajuda";
import type { Ambiente } from "../terminais-ui-ajuda";
import { gravarMedicoes, percentil, registrar } from "./registro";

const ambientes: Ambiente[] = [];
const abertos: AppAberto[] = [];
const novoAmbiente = (): Ambiente => { const a = criarAmbiente(); ambientes.push(a); return a; };
const iniciar = async (amb: Ambiente): Promise<AppAberto> => { const a = await abrir(amb); abertos.push(a); return a; };

afterAll(async () => {
  gravarMedicoes();
  for (const a of abertos) await a.app.close().catch(() => undefined);
  for (const a of ambientes) a.limpar();
});

const mb = (kb: number): number => kb / 1024;
const esperarPaineis = (a: AppAberto, n: number): Promise<unknown> =>
  a.pagina.waitForFunction((k) => document.querySelectorAll("section.terminais-painel[data-sessao]").length === k, n, { timeout: 20_000 });

/** Abre `n` painéis na mesma aba, dividindo o painel em foco (Cmd+D e Cmd+Shift+D alternados). */
async function abrirPaineis(a: AppAberto, n: number): Promise<string[]> {
  let ultimo = await prepararPrimeiraSessao(a.pagina);
  await esperarBuffer(a.pagina, ultimo, "pty> ");
  const conhecidos = new Set([ultimo]);
  for (let i = 1; i < n; i++) {
    await focarPainel(a.pagina, ultimo);
    await a.pagina.keyboard.press(i % 2 === 1 ? atalho("d") : atalho("d", "Shift"));
    await esperarPaineis(a, i + 1);
    ultimo = (await idsDosPaineis(a.pagina)).find((id) => !conhecidos.has(id)) as string;
    conhecidos.add(ultimo);
    await esperarBuffer(a.pagina, ultimo, "pty> ");
  }
  return idsDosPaineis(a.pagina);
}

describe("orçamentos dos terminais (P-03, P-05, P-04)", () => {
  let a: AppAberto;
  let sessao = "";

  it("P-03: abrir terminal (clique → xterm visível) ≤ 300 ms, sem contar a CLI", async () => {
    a = await iniciar(novoAmbiente());
    const p = a.pagina;
    await irParaTerminais(p);
    // espera a detecção de CLIs terminar (o menu lista o "Terminal" = CLI falsa)
    await p.getByRole("button", { name: /Nova sessão/ }).click();
    await p.getByRole("menuitem", { name: /^Terminal/ }).waitFor({ timeout: 30_000 });
    await p.keyboard.press("Escape");
    const tempos: number[] = [];
    // i = 0 é o AQUECIMENTO (1ª abertura do processo: carrega o chunk do xterm e compila o WebGL; fica no log e fora da
    // mediana, documentado); valem as 6 seguintes e o orçamento é a MEDIANA delas (o pior vai junto, no relatório).
    for (let i = 0; i < 7; i++) {
      await p.evaluate(() => {
        const w = window as unknown as { __abertura: { t0: number; t1: number | null } };
        const conhecidos = new Set(Array.from(document.querySelectorAll("section.terminais-painel[data-sessao]")).map((e) => (e as HTMLElement).dataset.sessao));
        w.__abertura = { t0: 0, t1: null };
        const aoClicar = (e: MouseEvent): void => {
          if (!(e.target as HTMLElement).closest('[role="menuitem"]')) return;
          w.__abertura.t0 = performance.now();
          document.removeEventListener("click", aoClicar, true);
        };
        document.addEventListener("click", aoClicar, true);
        const obs = new MutationObserver(() => {
          for (const s of Array.from(document.querySelectorAll("section.terminais-painel[data-sessao]")) as HTMLElement[]) {
            if (conhecidos.has(s.dataset.sessao)) continue;
            const tela = s.querySelector(".xterm-screen") as HTMLElement | null;
            if (tela !== null && tela.offsetWidth > 0 && tela.offsetHeight > 0) {
              obs.disconnect();
              requestAnimationFrame(() => { w.__abertura.t1 = performance.now(); });
              return;
            }
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
      });
      await p.getByRole("button", { name: /Nova sessão/ }).click();
      await p.getByRole("menuitem", { name: /^Terminal/ }).click();
      await p.waitForFunction(() => (window as unknown as { __abertura: { t1: number | null } }).__abertura.t1 !== null, undefined, { timeout: 15_000 });
      tempos.push(await p.evaluate(() => { const t = (window as unknown as { __abertura: { t0: number; t1: number } }).__abertura; return t.t1 - t.t0; }));
      await p.waitForTimeout(250);
    }
    const fria = tempos[0] as number;
    const medidas = tempos.slice(1);
    const m = registrar({ id: "P-03", descricao: "abrir terminal (clique → xterm visível, mediana de 6)", valor: percentil(medidas, 50), limite: 300, unidade: "ms", pior: Math.max(...medidas) });
    console.log(`P-03 amostras: aquecimento ${fria.toFixed(0)} ms; medidas ${medidas.map((t) => t.toFixed(0)).join(", ")} ms → mediana ${m.valor}, pior ${m.pior}`);
    const ids = await idsDosPaineis(p);
    sessao = ids[ids.length - 1] as string; // antes do expect: os testes seguintes dependem dela
    expect(m.ok, `${m.valor} ms > ${m.limite} ms`).toBe(true);
  });

  it("P-05: latência de digitação (tecla → eco pintado) p95 ≤ 40 ms", async () => {
    const p = a.pagina;
    await esperarBuffer(p, sessao, "pty> ");
    await focarPainel(p, sessao);
    await p.evaluate((id) => {
      const w = window as unknown as { __ade_terminais: Record<string, { texto(): string; aoProcessar(cb: () => void): () => void }>; __lat: number[]; __pend: number | null };
      const l = w.__ade_terminais[id]!;
      w.__lat = [];
      w.__pend = null;
      let base = 0;
      window.addEventListener("keydown", () => { w.__pend = performance.now(); base = l.texto().length; }, true);
      l.aoProcessar(() => {
        if (w.__pend === null || l.texto().length <= base) return;
        const t0 = w.__pend;
        w.__pend = null;
        requestAnimationFrame(() => { w.__lat.push(performance.now() - t0); });
      });
    }, sessao);
    // as 10 primeiras teclas AQUECEM (JIT, atlas de glifos do WebGL, caches de layout) e ficam fora do p95, documentado
    for (let i = 0; i < 70; i++) {
      await p.keyboard.press(String.fromCharCode(97 + (i % 26)));
      await p.waitForFunction((n) => (window as unknown as { __lat: number[] }).__lat.length >= n, i + 1, { timeout: 5_000 });
      await p.waitForTimeout(25);
    }
    const todas = await p.evaluate(() => (window as unknown as { __lat: number[] }).__lat);
    const lat = todas.slice(10);
    const p95 = percentil(lat, 95);
    const m = registrar({ id: "P-05", descricao: "eco de tecla (p95, 60 teclas após 10 de aquecimento)", valor: p95, limite: 40, unidade: "ms", pior: Math.max(...lat) });
    console.log(`P-05 aquecimento máx ${Math.max(...todas.slice(0, 10)).toFixed(1)} ms; p50=${percentil(lat, 50).toFixed(1)} p95=${p95.toFixed(1)} max=${Math.max(...lat).toFixed(1)} ms`);
    expect(m.ok, `p95 ${m.valor} ms > ${m.limite} ms`).toBe(true);
    await p.keyboard.press("Enter");
  });

  it("P-04: flood de 10 MB sem tarefa longa e a UI segue respondendo a teclas", async () => {
    const p = a.pagina;
    await focarPainel(p, sessao);
    await p.evaluate((id) => {
      const w = window as unknown as { __ade_terminais: Record<string, { fim(n: number): string; aoProcessar(cb: () => void): () => void }>; __longas: number[]; __fimFlood: boolean; __resp: number[] };
      w.__longas = [];
      w.__resp = [];
      w.__fimFlood = false;
      new PerformanceObserver((lista) => { for (const e of lista.getEntries()) w.__longas.push(e.duration); }).observe({ entryTypes: ["longtask"] });
      const l = w.__ade_terminais[id]!;
      l.aoProcessar(() => { if (!w.__fimFlood && l.fim(3).includes("flood-fim")) w.__fimFlood = true; });
      // resposta a tecla: Cmd+F (puramente local) → caixa de busca visível
      let t0: number | null = null;
      window.addEventListener("keydown", () => { t0 = performance.now(); }, true);
      new MutationObserver(() => {
        if (t0 !== null && document.querySelector('[role="search"][aria-label="Buscar no terminal"]') !== null) { const t = t0; t0 = null; requestAnimationFrame(() => w.__resp.push(performance.now() - t)); }
      }).observe(document.body, { childList: true, subtree: true });
    }, sessao);
    const inicioFlood = Date.now();
    await digitarLinha(p, sessao, "flood 10485760");
    // só valem as teclas dadas ENQUANTO o flood corre (a marca `duranteFlood` é lida no fim de cada ciclo)
    const durante: number[] = [];
    for (let i = 0; i < 40 && !(await p.evaluate(() => (window as unknown as { __fimFlood: boolean }).__fimFlood)); i++) {
      await focarPainel(p, sessao);
      const antes = await p.evaluate(() => (window as unknown as { __resp: number[] }).__resp.length);
      await p.keyboard.press(atalho("f"));
      await p.waitForFunction((n) => (window as unknown as { __resp: number[] }).__resp.length > n, antes, { timeout: 10_000 });
      const resp = await p.evaluate(() => (window as unknown as { __resp: number[] }).__resp.at(-1) as number);
      const aindaCorre = !(await p.evaluate(() => (window as unknown as { __fimFlood: boolean }).__fimFlood));
      if (aindaCorre) durante.push(resp);
      await p.waitForFunction(() => document.activeElement?.closest('[role="search"][aria-label="Buscar no terminal"]') != null, undefined, { timeout: 10_000 });
      await p.keyboard.press("Escape");
      await p.waitForFunction(() => document.querySelector('[role="search"][aria-label="Buscar no terminal"]') === null, undefined, { timeout: 10_000 });
    }
    expect(durante.length, "teclas dadas durante o flood (a 1ª, fria, não conta)").toBeGreaterThanOrEqual(4);
    await p.waitForFunction(() => (window as unknown as { __fimFlood: boolean }).__fimFlood, undefined, { timeout: 110_000 });
    const { longas } = await p.evaluate(() => { const w = window as unknown as { __longas: number[]; __resp: number[] }; return { longas: w.__longas }; });
    console.log(`P-04 flood completo em ${Date.now() - inicioFlood} ms`);
    const maxLonga = longas.length === 0 ? 0 : Math.max(...longas);
    console.log(`P-04 longtasks: ${longas.length} (max ${maxLonga.toFixed(0)} ms); teclas durante o flood (${durante.length}): ${durante.map((r) => r.toFixed(0)).join(", ")} ms`);
    // a 1ª tecla monta a caixa de busca pela 1ª vez (fria): fica no log e fora do p95, documentado
    const quentes = durante.slice(1);
    const m = registrar({ id: "P-04", descricao: "flood 10 MB: maior tarefa longa do renderer", valor: maxLonga, limite: 50, unidade: "ms", pior: maxLonga });
    const r = registrar({ id: "P-04b", descricao: "flood 10 MB: tecla (Cmd+F) → UI responde (p95, sem a 1ª fria)", valor: percentil(quentes, 95), limite: 100, unidade: "ms", pior: Math.max(...quentes) });
    expect(m.ok, `tarefa longa ${m.valor} ms > ${m.limite} ms`).toBe(true);
    expect(r.ok, `resposta a tecla ${r.valor} ms > ${r.limite} ms`).toBe(true);
    // depois do flood o terminal segue vivo
    await digitarLinha(p, sessao, "vivo");
    await esperarBuffer(p, sessao, "eco:vivo", 60_000);
  });
});

/** Memória do processo principal (Browser) e do renderer (Tab) pelo Electron; RSS do daemon pelo `ps`. */
async function memoria(a: AppAberto, pastaDados: string): Promise<{ rendererMB: number; mainMB: number; daemonMB: number }> {
  const metricas = await a.app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ tipo: m.type, pid: m.pid, ws: m.memory.workingSetSize, priv: m.memory.privateBytes ?? 0 })));
  const renderer = metricas.filter((m) => m.tipo === "Tab").reduce((s, m) => s + m.ws, 0);
  const main = metricas.filter((m) => m.tipo === "Browser").reduce((s, m) => s + m.ws, 0);
  let daemonKb = 0;
  try {
    const ps = execFileSync("ps", ["-axo", "pid=,rss=,command="], { encoding: "utf8" });
    for (const linha of ps.split("\n")) {
      if (linha.includes("main-daemon.js") && linha.includes(pastaDados)) daemonKb += Number(linha.trim().split(/\s+/)[1] ?? 0);
    }
  } catch { /* sem ps: o teste falha abaixo por daemon = 0 */ }
  return { rendererMB: mb(renderer), mainMB: mb(main), daemonMB: mb(daemonKb) };
}

describe("orçamentos de memória (P-06, P-07)", () => {
  it("P-06/P-07: 4 painéis ociosos — renderer ≤ 250 MB; main + daemon ≤ 200 MB", async () => {
    const amb = novoAmbiente();
    const a = await iniciar(amb);
    const ids = await abrirPaineis(a, 4);
    expect(ids).toHaveLength(4);
    // "ocioso": o RSS logo depois de abrir painéis é um pico que o SO devolve sozinho (129 → 91 MB no main em 12 s).
    // Amostra a cada 2 s e só aceita o valor quando 3 amostras seguidas variam menos de 4 MB (teto de 30 s);
    // vale o MAIOR valor dessas 3 amostras estáveis, nunca o menor.
    const hist: Array<{ rendererMB: number; mainMB: number; daemonMB: number }> = [];
    for (let i = 0; i < 15; i++) {
      await a.pagina.waitForTimeout(2_000);
      hist.push(await memoria(a, amb.pastaDados));
      const ult = hist.slice(-3);
      const soma = (x: (typeof hist)[number]): number => x.rendererMB + x.mainMB + x.daemonMB;
      if (ult.length === 3 && Math.max(...ult.map(soma)) - Math.min(...ult.map(soma)) < 4) break;
    }
    const estaveis = hist.slice(-3);
    const r = { rendererMB: Math.max(...estaveis.map((x) => x.rendererMB)), mainMB: Math.max(...estaveis.map((x) => x.mainMB)), daemonMB: Math.max(...estaveis.map((x) => x.daemonMB)) };
    console.log(`P-06/P-07 amostras (renderer/main/daemon MB): ${hist.map((x) => `${x.rendererMB.toFixed(0)}/${x.mainMB.toFixed(0)}/${x.daemonMB.toFixed(0)}`).join(" ")}`);
    const p6 = registrar({ id: "P-06", descricao: "memória do renderer, 4 painéis ociosos", valor: r.rendererMB, limite: 250, unidade: "MB", pior: Math.max(...hist.map((x) => x.rendererMB)) });
    expect(r.daemonMB, "daemon não encontrado pelo ps").toBeGreaterThan(0);
    const p7 = registrar({ id: "P-07", descricao: "memória main + daemon, 4 painéis ociosos", valor: r.mainMB + r.daemonMB, limite: 200, unidade: "MB", pior: Math.max(...hist.map((x) => x.mainMB + x.daemonMB)) });
    expect(p6.ok, `${p6.valor} MB > ${p6.limite} MB`).toBe(true);
    expect(p7.ok, `${p7.valor} MB > ${p7.limite} MB`).toBe(true);
  });
});

describe("restauração (P-13)", () => {
  it("P-13: 8 painéis restaurados ≤ 1,5 s depois de fechar e reabrir o app (mediana de 3 reaberturas; a 1ª, fria, é descartada)", async () => {
    const amb = novoAmbiente();
    let atual = await iniciar(amb);
    const ids = await abrirPaineis(atual, 8);
    expect(ids).toHaveLength(8);
    await atual.pagina.waitForTimeout(1_200); // o layout é gravado com debounce
    const tempos: number[] = [];
    // 4 reaberturas: a 1ª tem o cache do SO e o chunk do xterm frios (fica no log, fora da mediana); valem as 3 seguintes
    for (let volta = 0; volta < 4; volta++) {
      await atual.fechar();
      const t0Lancamento = Date.now();
      atual = await iniciar(amb);
      const p = atual.pagina;
      await p.waitForSelector('nav[aria-label="Principal"]', { timeout: 15_000 });
      // marcas DENTRO da página (sem o atraso de ida e volta do Playwright): clique no menu → painéis visíveis → saída restaurada
      await p.evaluate(() => {
        const w = window as unknown as { __rest: Record<string, number>; __ade_terminais?: Record<string, { texto(): string }> };
        w.__rest = {};
        document.addEventListener("click", () => { w.__rest["click"] ??= performance.now(); }, true);
        const marca = (k: string): void => { w.__rest[k] ??= performance.now(); };
        const conferir = (): void => {
          const telas = Array.from(document.querySelectorAll("section.terminais-painel[data-sessao] .xterm-screen")) as HTMLElement[];
          if (telas.length === 8 && telas.every((t) => t.offsetWidth > 0 && t.offsetHeight > 0)) marca("visiveis");
          const mapa = w.__ade_terminais ?? {};
          if (Object.keys(mapa).length === 8 && Object.values(mapa).every((l) => l.texto().includes("pty> "))) marca("conteudo");
        };
        new MutationObserver(conferir).observe(document.body, { childList: true, subtree: true, characterData: true });
        setInterval(conferir, 5);
      });
      await irParaTerminais(p);
      await p.waitForFunction(() => (window as unknown as { __rest: Record<string, number> }).__rest["conteudo"] !== undefined, undefined, { timeout: 20_000 });
      const marcas = await p.evaluate(() => (window as unknown as { __rest: Record<string, number> }).__rest);
      const visiveis = marcas["visiveis"]! - marcas["click"]!;
      const comConteudo = marcas["conteudo"]! - marcas["click"]!;
      console.log(`P-13 reabertura ${volta}${volta === 0 ? " (fria)" : ""}: visíveis ${visiveis.toFixed(0)} ms; com saída restaurada ${comConteudo.toFixed(0)} ms (desde o clique em Terminais); lançamento → restaurado ${Date.now() - t0Lancamento} ms`);
      expect((await idsDosPaineis(p)).sort()).toEqual([...ids].sort());
      tempos.push(comConteudo);
    }
    const medidas = tempos.slice(1);
    const m = registrar({ id: "P-13", descricao: "restaurar 8 painéis (clique em Terminais → 8 visíveis com saída, mediana de 3)", valor: percentil(medidas, 50), limite: 1500, unidade: "ms", pior: Math.max(...medidas) });
    expect(m.ok, `${m.valor} ms > ${m.limite} ms`).toBe(true);
  });
});
