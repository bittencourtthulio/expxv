// @vitest-environment jsdom
// Sistema de partes (D-674/D-675): catálogo de 100 espécies, receitas completas e distintas, todos os estágios/humores/esforços, variantes, ovo em 4 níveis e nascimento.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ESPECIES, ESPECIES_LEGADAS, ESTAGIOS, HUMORES, type EspecieId, type NivelEsforco } from "../../../compartilhado/bichinho";
import { CATALOGO } from "../../../nucleo/bichinho/catalogo";
import { arteDe, ARTE } from "../arte";
import { BichinhoSprite, nivelDoOvo } from "../Sprite";
import { RECEITAS } from "./receitas";
import { ARQUETIPOS, CAUDAS, EXTRAS, FOCINHOS, MARCAS, ORELHAS, PALETAS } from "./tipos";

afterEach(cleanup);
const css = readFileSync(join(__dirname, "..", "bichinho.css"), "utf8");
const NOVAS = ESPECIES.slice(14) as EspecieId[];
const html = (p: Parameters<typeof BichinhoSprite>[0]): string => renderToStaticMarkup(<BichinhoSprite {...p} />);

describe("catálogo e receitas", () => {
  it("100 espécies únicas, ids ASCII estáveis, catálogo completo", () => {
    expect(ESPECIES).toHaveLength(100);
    expect(new Set(ESPECIES).size).toBe(100);
    for (const e of ESPECIES) { expect(e).toMatch(/^[a-z]+(-[a-z]+)*$/); expect(CATALOGO[e].id).toBe(e); expect(CATALOGO[e].rotulo.length).toBeGreaterThan(2); }
    expect(new Set(ESPECIES.map((e) => CATALOGO[e].rotulo)).size).toBe(100);
    expect(ESPECIES_LEGADAS).toEqual(["caranguejo", "piton", "esquilo", "raposa", "camaleao", "lontra", "tucano", "elefante", "ourico", "coruja", "polvo", "gato", "sapo", "urso"]);
  });

  it("as 86 novas têm receita completa e válida; as 14 legadas continuam com a arte própria", () => {
    expect(Object.keys(RECEITAS).sort()).toEqual([...NOVAS].sort());
    expect(Object.keys(ARTE).sort()).toEqual([...ESPECIES_LEGADAS].sort());
    for (const [id, r] of Object.entries(RECEITAS)) {
      expect(ARQUETIPOS, id).toContain(r.a);
      expect(r.p, id).toBeGreaterThanOrEqual(0);
      expect(r.p, id).toBeLessThan(PALETAS);
      if (r.o !== undefined) expect(ORELHAS, id).toContain(r.o);
      if (r.c !== undefined) expect(CAUDAS, id).toContain(r.c);
      if (r.f !== undefined) expect(FOCINHOS, id).toContain(r.f);
      if (r.m !== undefined) expect(MARCAS, id).toContain(r.m);
      for (const x of r.x ?? []) expect(EXTRAS, id).toContain(x);
      expect(r.t.length, id).toBeGreaterThanOrEqual(2);
      expect(r.t.length, id).toBeLessThanOrEqual(3);
      expect(JSON.stringify(r).length, id).toBeLessThan(200);
    }
  });

  it("as 100 artes são distintas entre si e as âncoras (olhos, boca) cabem no viewBox 64", () => {
    const vistos = new Set<string>();
    for (const e of ESPECIES) {
      const a = arteDe(e);
      expect(arteDe(e)).toBe(a);
      for (const [x, y] of a.olhos) { expect(x).toBeGreaterThan(4); expect(x).toBeLessThan(60); expect(y).toBeGreaterThan(2); expect(y).toBeLessThan(58); }
      expect(a.olhos[0][0]).toBeLessThan(a.olhos[1][0]);
      expect(a.r).toBeGreaterThan(1);
      if (a.boca !== null) { expect(a.boca[0]).toBeGreaterThan(8); expect(a.boca[0]).toBeLessThan(56); expect(a.boca[1]).toBeGreaterThan(20); expect(a.boca[1]).toBeLessThan(56); }
      vistos.add(html({ especie: e, estagio: "jovem" }).replace(/aria-label="[^"]*"/, "").replace(/ id="[^"]*"/g, "").replace(/data-especie="[^"]*"/, ""));
    }
    expect(vistos.size).toBe(100);
  });
});

describe("renderização completa", () => {
  it("100 espécies × 6 estágios × 8 humores × esforço 0–4 × doente: sem erro, com role=img e atributos de estado", () => {
    let total = 0;
    for (const especie of ESPECIES) for (const estagio of ESTAGIOS) for (const humor of HUMORES) for (const nivel of [0, 1, 2, 3, 4] as NivelEsforco[]) {
      const m = html({ especie, estagio, humor, nivel, doente: nivel % 2 === 1, maturidade: 5 });
      expect(m).toContain('role="img"');
      expect(m).toContain(`data-especie="${especie}"`);
      expect(m).toContain(`data-estagio="${estagio}"`);
      total++;
    }
    expect(total).toBe(100 * 6 * 8 * 5);
  });

  it("acessórios e poses encaixam em qualquer espécie: lenço, óculos, cicatriz, medalha, coroa, aura, notebook, balão", () => {
    for (const especie of ESPECIES) {
      const lenda = html({ especie, estagio: "lendario", humor: "trabalhando" });
      for (const c of ["bi-lenco", "bi-oculos", "bi-cicatriz", "bi-medalha", "bi-coroa", "bi-aura", "bi-notebook"]) expect(lenda, `${especie} ${c}`).toContain(c);
      expect(html({ especie, estagio: "adulto", humor: "aguardando" })).toContain("bi-balao");
      expect(html({ especie, estagio: "filhote" })).not.toContain("bi-lenco");
    }
  });

  it("cada espécie nova declara a paleta e a legada não", () => {
    for (const e of NOVAS) expect(html({ especie: e, estagio: "jovem" })).toContain(`data-pal="${RECEITAS[e as keyof typeof RECEITAS].p}"`);
    for (const e of ESPECIES_LEGADAS) expect(html({ especie: e, estagio: "jovem" })).not.toContain("data-pal");
  });
});

describe("variantes (D-675)", () => {
  it("0 = original (sem atributo); 1 a 3 marcam data-var e acrescentam uma marca; fora da faixa é limitado", () => {
    for (const e of ["raposa", "zebra", "pinguim", "estrela-do-mar"] as const) {
      expect(html({ especie: e, estagio: "adulto", variante: 0 })).not.toContain("data-var");
      expect(html({ especie: e, estagio: "adulto" })).not.toContain("bi-marca");
      const marcas = new Set<string>();
      for (const v of [1, 2, 3]) {
        const m = html({ especie: e, estagio: "adulto", variante: v });
        expect(m).toContain(`data-var="${v}"`);
        expect(m).toContain("bi-marca");
        marcas.add(m);
      }
      expect(marcas.size).toBe(3);
    }
    expect(html({ especie: "gato", estagio: "adulto", variante: 9 })).toContain('data-var="3"');
    expect(html({ especie: "gato", estagio: "adulto", variante: -2 })).not.toContain("data-var");
  });

  it("as variantes rotacionam a paleta por CSS, sem rosa e sem cor literal", () => {
    for (const v of [1, 2, 3]) expect(css).toMatch(new RegExp(`\\.bi\\[data-var="${v}"\\]`));
    const regras = [...css.matchAll(/^\.bi\[data-(?:var|pal)="[^"]+"\][^\n]*$/gm)].map((m) => m[0]);
    expect(regras.length).toBeGreaterThanOrEqual(PALETAS + 3);
    // rosa nasce de vermelho com branco ou roxo: nenhuma regra de paleta ou variante mistura alerta com papel/grafico-5/destaque
    for (const r of regras) {
      for (const mix of r.matchAll(/color-mix\(in srgb, ([^)]*(?:\([^)]*\))?[^)]*)\)/g)) {
        const t = mix[1]!;
        if (/var\(--alerta\)/.test(t)) expect(t, r).not.toMatch(/papel|grafico-5|destaque\)/);
      }
    }
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/);
  });
});

describe("ovo em 4 níveis e nascimento (D-671)", () => {
  it("o nível visual segue o progresso: 0–24, 25–49, 50–74, 75–99", () => {
    const tabela: Array<[number, 0 | 1 | 2 | 3]> = [[0, 0], [24, 0], [24.9, 0], [25, 1], [49, 1], [50, 2], [74, 2], [75, 3], [99, 3], [100, 3]];
    for (const [p, n] of tabela) {
      expect(nivelDoOvo(p), String(p)).toBe(n);
      expect(html({ especie: "gato", estagio: "ovo", progressoOvo: p })).toContain(`data-ovo-nivel="${n}"`);
    }
    // sem progresso (versão antiga do main): rachado a partir de maturidade 1
    expect(nivelDoOvo(undefined, 0)).toBe(0);
    expect(nivelDoOvo(undefined, 2)).toBe(1);
  });

  it("cada nível acrescenta o seu desenho: rachadura, olho espiando, casca solta", () => {
    const tem = (p: number, sel: string): boolean => render(<BichinhoSprite especie="raposa" estagio="ovo" progressoOvo={p} />).container.querySelector(sel) !== null;
    expect(tem(10, ".bi-rachadura")).toBe(true);
    expect(render(<BichinhoSprite especie="raposa" estagio="ovo" progressoOvo={10} />).container.querySelector<SVGElement>(".bi-rachadura")!.style.opacity).toBe("0");
    expect(render(<BichinhoSprite especie="raposa" estagio="ovo" progressoOvo={30} />).container.querySelector<SVGElement>(".bi-rachadura")!.style.opacity).toBe("1");
    expect(tem(30, ".bi-espia")).toBe(false);
    expect(tem(60, ".bi-espia")).toBe(true);
    expect(tem(60, ".bi-tampa")).toBe(false);
    expect(tem(90, ".bi-tampa")).toBe(true);
    expect(tem(90, ".bi-espia")).toBe(true);
  });

  it("o ovo reage ao esforço mas nunca comemora: sem confete nem pulo, mesmo com humor comemorando ou subiu", () => {
    for (const p of [0, 30, 60, 90]) {
      const m = html({ especie: "polvo", estagio: "ovo", progressoOvo: p, humor: "comemorando", subiu: true, nivel: 4 });
      expect(m).not.toContain("bi-confete");
      expect(m).toContain('data-nivel="4"');
    }
    // fora do ovo o confete continua
    expect(html({ especie: "polvo", estagio: "filhote", humor: "comemorando" })).toContain("bi-confete");
  });

  it("o nascimento renderiza a casca uma vez; sem `nasceu` (ou no ovo) não há casca", () => {
    const c = render(<BichinhoSprite especie="capivara" estagio="filhote" nasceu />).container;
    expect(c.querySelector(".bi-casca")).not.toBeNull();
    expect(c.querySelector(".bi-casca-e")).not.toBeNull();
    expect(c.querySelector(".bi-casca-d")).not.toBeNull();
    expect(c.querySelector("svg")!.getAttribute("data-nasceu")).toBe("true");
    expect(html({ especie: "capivara", estagio: "filhote" })).not.toContain("bi-casca");
    expect(html({ especie: "capivara", estagio: "ovo", nasceu: true })).not.toContain("bi-casca");
  });

  it("CSS: nascer e a casca têm iteração única, só com movimento permitido; o balanço do ovo só existe com esforço", () => {
    const nasc = [...css.matchAll(/[^{}\n]*(?:bi-aparece|bi-casca-[ed])[^{}\n]*\{[^}]*animation:[^}]*\}/g)].map((m) => m[0]);
    expect(nasc.length).toBe(3);
    for (const r of nasc) { expect(r).not.toMatch(/infinite/); expect(r).toMatch(/ 1 both/); expect(r).toContain(":not([data-quieto])"); }
    expect(css).toMatch(/\.bi-casca \{ display: none; \}/);
    const mov = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"));
    for (const k of ["bi-nascer", "bi-casca-e", "bi-casca-d", "bi-ovo-balanca"]) expect(mov, k).toMatch(new RegExp(`animation: ${k}`));
    expect(css).toMatch(/\.bi\[data-estagio="ovo"\]:not\(\[data-nivel="0"\]\) \.bi-ovo \{ animation: bi-ovo-balanca/);
  });
});
