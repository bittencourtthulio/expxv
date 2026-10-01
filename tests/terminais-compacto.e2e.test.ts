// E2E D-32 (área de trabalho máxima) sobre o Electron real: mede a FRAÇÃO da altura da janela ocupada pelo terminal
// (1 painel, 2 e 4 painéis), a linha única de controles, o modo foco, e grava os screenshots para o dono ver.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { RAIZ } from "./fixture";
import type { AppAberto } from "./fixture";
import { abrir, atalho, criarAmbiente, esperarBuffer, idsDosPaineis, prepararPrimeiraSessao, vigiarDialogos } from "./terminais-ui-ajuda";
import type { Ambiente } from "./terminais-ui-ajuda";

const PASTA_PERF = join(RAIZ, "docs", "ade", "perf");
let amb: Ambiente;
let app: AppAberto;
let primeira = "";
const pagina = (): Page => app.pagina;

beforeAll(async () => {
  amb = criarAmbiente();
  mkdirSync(PASTA_PERF, { recursive: true });
  app = await abrir(amb);
  await vigiarDialogos(app);
  primeira = await prepararPrimeiraSessao(app.pagina);
  await app.pagina.waitForSelector(`section[data-sessao="${primeira}"] .xterm-screen`, { timeout: 15_000 });
  await esperarBuffer(app.pagina, primeira, "pty> ");
});
afterAll(async () => {
  await app?.fechar();
  amb.limpar();
});

interface Medida { janela: { w: number; h: number }; topo: number; rodape: number; barra: number; telas: Array<{ id: string; x: number; y: number; w: number; h: number }>; corpos: Array<{ y: number; h: number }>; abas: number; cabecalhoVisivel: number }

const medir = (p: Page): Promise<Medida> => p.evaluate(() => {
  const r = (e: Element | null): DOMRect => (e as HTMLElement).getBoundingClientRect();
  return {
    janela: { w: window.innerWidth, h: window.innerHeight },
    topo: r(document.querySelector("header.casca-topo")).height,
    rodape: r(document.querySelector("footer.rodape")).height,
    barra: r(document.querySelector(".terminais-barra")).height,
    telas: Array.from(document.querySelectorAll("section.terminais-painel[data-sessao]")).map((s) => {
      const b = r(s.querySelector(".xterm-screen"));
      return { id: (s as HTMLElement).dataset.sessao as string, x: b.x, y: b.y, w: b.width, h: b.height };
    }),
    corpos: Array.from(document.querySelectorAll("section.terminais-painel[data-sessao] .terminais-painel-corpo")).map((c) => { const b = r(c); return { y: b.y, h: b.height }; }),
    abas: document.querySelectorAll(".terminais-barra [role=tab]").length,
    cabecalhoVisivel: Array.from(document.querySelectorAll(".terminais-painel-cabecalho")).filter((c) => getComputedStyle(c).opacity !== "0").length,
  };
});

/** altura do bloco de terminais (do topo do primeiro ao fim do último) / altura da janela */
const fracaoAltura = (m: Medida): number => (Math.max(...m.telas.map((t) => t.y + t.h)) - Math.min(...m.telas.map((t) => t.y))) / m.janela.h;
/** área de trabalho do terminal (o corpo do painel, de borda a borda) / altura da janela */
const fracaoCorpo = (m: Medida): number => (Math.max(...m.corpos.map((t) => t.y + t.h)) - Math.min(...m.corpos.map((t) => t.y))) / m.janela.h;
const fracaoArea = (m: Medida): number => m.telas.reduce((a, t) => a + t.w * t.h, 0) / (m.janela.w * m.janela.h);

const esperarPaineis = (p: Page, n: number): Promise<unknown> =>
  p.waitForFunction((k) => document.querySelectorAll("section.terminais-painel[data-sessao] .xterm-screen").length === k, n, { timeout: 15_000 });
const dividir = async (p: Page, nome: RegExp, n: number): Promise<void> => {
  await p.locator(".terminais-barra").getByRole("button", { name: nome }).click();
  await esperarPaineis(p, n);
  await p.waitForTimeout(450); // fit debounced do xterm
};

describe("tela Terminais compacta (D-32)", () => {
  it("1 painel: casca fina, uma linha de controles ≤ 28 px e terminal ≥ 85% da altura da janela", async () => {
    const p = pagina();
    await p.mouse.move(900, p.viewportSize()?.height ? (p.viewportSize()!.height - 3) : 780); // fora do painel: o cabeçalho único só aparece no hover
    await p.waitForTimeout(500);
    const m = await medir(p);
    console.log("[compacto] 1 painel", JSON.stringify({ janela: m.janela, topo: m.topo, rodape: m.rodape, barra: m.barra, fracaoAltura: fracaoAltura(m), fracaoCorpo: fracaoCorpo(m), fracaoArea: fracaoArea(m) }));
    expect(m.topo).toBeLessThanOrEqual(40);
    expect(m.rodape).toBeLessThanOrEqual(26);
    expect(m.barra).toBeLessThanOrEqual(28);
    expect(m.telas).toHaveLength(1);
    expect(fracaoCorpo(m)).toBeGreaterThanOrEqual(0.85);
    expect(fracaoAltura(m)).toBeGreaterThanOrEqual(0.85); // o xterm só perde a sobra de uma linha de texto
    expect(m.cabecalhoVisivel).toBe(0); // painel único: cabeçalho só no hover/foco
    await p.screenshot({ path: join(PASTA_PERF, "compacto-1painel.png") });
  });

  it("a linha não quebra com muitas abas (rolagem horizontal) e a altura da barra não muda", async () => {
    const p = pagina();
    const antes = (await medir(p)).barra;
    for (let i = 0; i < 4; i += 1) {
      await p.keyboard.press(atalho("n"));
      await p.waitForFunction((n) => document.querySelectorAll(".terminais-barra [role=tab]").length === n, i + 2, { timeout: 15_000 });
    }
    const m = await medir(p);
    expect(m.abas).toBe(5);
    expect(m.barra).toBe(antes);
    const unica = await p.evaluate(() => document.querySelectorAll(".terminais-barra").length);
    expect(unica).toBe(1);
    // volta a uma aba só para as medidas seguintes
    for (let i = 0; i < 4; i += 1) await p.locator(".terminais-aba:last-child .terminais-aba-fechar").click();
    await p.waitForFunction(() => document.querySelectorAll(".terminais-barra [role=tab]").length === 1, null, { timeout: 15_000 });
    expect(await idsDosPaineis(p)).toEqual([primeira]);
  });

  it("2 painéis divididos: terminal ≥ 85% da altura da janela somando a área", async () => {
    const p = pagina();
    await dividir(p, /Dividir lado a lado/, 2);
    const m = await medir(p);
    console.log("[compacto] 2 paineis", JSON.stringify({ fracaoAltura: fracaoAltura(m), fracaoCorpo: fracaoCorpo(m), fracaoArea: fracaoArea(m), cabecalhos: m.cabecalhoVisivel }));
    expect(m.telas).toHaveLength(2);
    expect(fracaoCorpo(m)).toBeGreaterThanOrEqual(0.85);
    expect(fracaoAltura(m)).toBeGreaterThanOrEqual(0.84);
    expect(m.cabecalhoVisivel).toBe(2);
  });

  it("4 painéis: grade 2x2 mantém a área e gera o screenshot", async () => {
    const p = pagina();
    await dividir(p, /Dividir em cima e embaixo/, 3); // o novo (direita) é dividido
    await p.locator(`section[data-sessao="${primeira}"] .terminais-painel-cabecalho`).click();
    await dividir(p, /Dividir em cima e embaixo/, 4);
    await p.mouse.move(900, 500);
    await p.waitForTimeout(300);
    const m = await medir(p);
    console.log("[compacto] 4 paineis", JSON.stringify({ fracaoAltura: fracaoAltura(m), fracaoCorpo: fracaoCorpo(m), fracaoArea: fracaoArea(m) }));
    expect(m.telas).toHaveLength(4);
    expect(fracaoCorpo(m)).toBeGreaterThanOrEqual(0.8); // 2 linhas de painéis: 2 cabeçalhos de 18 px + divisor de 2 px
    await p.screenshot({ path: join(PASTA_PERF, "compacto-4paineis.png") });
  });

  it("modo foco: expande o painel, a linha some e volta ao levar o mouse à borda superior", async () => {
    const p = pagina();
    await p.locator(`section[data-sessao="${primeira}"] textarea`).focus();
    await p.keyboard.press(atalho("Enter", "Shift").replace("+Shift+Shift", "+Shift"));
    await esperarPaineis(p, 1);
    await p.mouse.move(900, 400);
    await p.waitForTimeout(400);
    const oculta = await p.evaluate(() => { const b = document.querySelector(".terminais-barra") as HTMLElement; const cs = getComputedStyle(b); return { visibility: cs.visibility, oculta: b.hasAttribute("data-oculta") }; });
    expect(oculta).toEqual({ visibility: "hidden", oculta: true });
    const m = await medir(p);
    console.log("[compacto] foco", JSON.stringify({ fracaoAltura: fracaoAltura(m) }));
    expect(fracaoAltura(m)).toBeGreaterThanOrEqual(0.9);
    const topoDaArea = await p.evaluate(() => (document.querySelector(".terminais-tela") as HTMLElement).getBoundingClientRect().top);
    await p.mouse.move(900, topoDaArea + 1); // borda superior da área de trabalho
    await p.waitForFunction(() => getComputedStyle(document.querySelector(".terminais-barra") as HTMLElement).visibility === "visible", null, { timeout: 5_000 });
    await p.mouse.move(900, 500);
    await p.waitForFunction(() => getComputedStyle(document.querySelector(".terminais-barra") as HTMLElement).visibility === "hidden", null, { timeout: 5_000 });
    await p.locator(`section[data-sessao="${primeira}"] textarea`).focus();
    await p.keyboard.press(atalho("Enter", "Shift").replace("+Shift+Shift", "+Shift"));
    await esperarPaineis(p, 4);
  });
});
