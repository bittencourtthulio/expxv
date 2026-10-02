import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirApp } from "./fixture";
import type { AppAberto } from "./fixture";

// Escrito para rodar com `npm run build` feito. Redimensiona a janela e confere que o conteúdo do Início
// ocupa 100% da área de conteúdo (largura da área menos o padding, sem margem lateral automática) e que não há rolagem horizontal.
const TAMANHOS: ReadonlyArray<[number, number]> = [[800, 600], [1280, 800], [1920, 1080], [2560, 1440]];

let a: AppAberto;
beforeAll(async () => { a = await abrirApp(); });
afterAll(async () => { await a.fechar(); });

describe("layout ocupa 100% da área e é fluido (Início)", () => {
  for (const [w, h] of TAMANHOS) {
    it(`${w}x${h}: conteúdo preenche a área, sem margem lateral automática e sem rolagem horizontal`, async () => {
      await a.pagina.setViewportSize({ width: w, height: h });
      await a.pagina.waitForSelector(".tela .pagina[data-modo]", { timeout: 15000 });
      const r = await a.pagina.evaluate(() => {
        const conteudo = document.querySelector(".casca-conteudo")!.getBoundingClientRect();
        const pagina = document.querySelector(".tela:not([hidden]) .pagina") as HTMLElement;
        const card = pagina.getBoundingClientRect();
        const est = getComputedStyle(pagina);
        const pad = parseFloat(est.paddingLeft) + parseFloat(est.paddingRight);
        const conteudoUtil = card.width - pad;
        return {
          sobraEsq: card.left - conteudo.left,
          sobraDir: conteudo.right - card.right,
          larguraUtil: conteudoUtil,
          larguraEsperada: conteudo.width - pad,
          margemEsq: est.marginLeft,
          margemDir: est.marginRight,
          rolagemH: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          telaH: (() => { const t = document.querySelector(".tela:not([hidden])")!; return t.scrollWidth > t.clientWidth + 1; })(),
        };
      });
      expect(r.sobraEsq).toBeLessThanOrEqual(2);
      expect(r.sobraDir).toBeLessThanOrEqual(2);
      expect(Math.abs(r.larguraUtil - r.larguraEsperada)).toBeLessThanOrEqual(2);
      expect(r.margemEsq).toBe("0px");
      expect(r.margemDir).toBe("0px");
      expect(r.rolagemH).toBe(false);
      expect(r.telaH).toBe(false);
    });
  }
});
