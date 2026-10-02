import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MODO_DA_TELA, SEM_PAGINA } from "./modos-tela";
import { TELAS } from "../casca/telas";

const RENDERER = resolve(__dirname, "..");
const css = readFileSync(join(RENDERER, "componentes/pagina.css"), "utf8");

function fontes(pasta: string): string {
  return readdirSync(pasta)
    .filter((n) => /\.tsx$/.test(n) && !/\.test\./.test(n))
    .map((n) => readFileSync(join(pasta, n), "utf8"))
    .join("\n");
}

describe("layout fluido das páginas (CSS estático)", () => {
  it("o contêiner ocupa 100% da área: sem margem lateral automática nem teto de largura", () => {
    expect(css).not.toMatch(/margin-inline:\s*auto|margin:\s*0\s+auto|margin-(left|right):\s*auto/);
    expect(css).toMatch(/width:\s*var\(--largura-pagina,\s*var\(--largura-total\)\)/);
    for (const t of ["estreita", "padrao", "larga", "total"]) expect(css).toMatch(new RegExp(`--largura-${t}:\\s*100%`));
    expect(css).not.toMatch(/(?:^|[;{\s])max-width\s*:\s*(?=\S)(?!none)[^;]+/m);
    expect(css).toMatch(/clamp\(/);
    expect(css).toMatch(/auto-fit,\s*minmax\(min\(100%/);
    expect(css).toContain("prefers-reduced-motion");
  });

  it("nenhum contêiner raiz de tela fixa max-width nem usa margin-inline: auto (CSS de telas e da página)", () => {
    const pasta = join(RENDERER, "telas");
    const raizes = /^\.(?:consumo|harness|agil|relatorios|alertas-tela|cat-tela|lm-tela|jarvis-tela|sq-tela|vc-tela|memoria|bench|chat|pipelines|mapa|conhecimento|metodo|missoes|inicio|cfg-secoes|prov-lista|ini-grade|pagina)\s*\{([^}]*)\}/gm;
    for (const d of readdirSync(pasta)) {
      const dir = join(pasta, d);
      if (!statSync(dir).isDirectory()) continue;
      for (const n of readdirSync(dir).filter((x) => x.endsWith(".css"))) {
        for (const m of readFileSync(join(dir, n), "utf8").matchAll(raizes)) {
          expect(m[1], `${d}/${n}`).not.toMatch(/max-width\s*:\s*(?=\S)(?!none|100%)/);
          expect(m[1], `${d}/${n}`).not.toMatch(/margin(-inline)?\s*:\s*(0\s+)?auto/);
        }
      }
    }
    const cfg = readFileSync(join(pasta, "config/config.css"), "utf8");
    expect(/^\.cfg-secoes\s*\{([^}]*)\}/m.exec(cfg)?.[1]).toMatch(/auto-fit/);
  });

  it("não usa cor literal nem largura fixa em px acima de 1600 px", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    for (const m of css.matchAll(/(?:^|[;{\s])(?:width|min-width)\s*:\s*(\d+)px/g)) expect(Number(m[1])).toBeLessThanOrEqual(1600);
    for (const m of css.matchAll(/--largura-[a-z]+:\s*(\d+)px/g)) expect(Number(m[1])).toBeLessThanOrEqual(1600);
  });

  it("a raiz de cada tela não fixa largura em px (só teto fluido)", () => {
    const pasta = join(RENDERER, "telas");
    const raizes = /^\.(?:consumo|harness|agil|relatorios|alertas-tela|cat-tela|lm-tela|jarvis-tela|sq-tela|vc-tela|terminais-tela|memoria|bench|chat|pipelines|mapa|conhecimento|ini-grade|prov-lista)\s*\{([^}]*)\}/gm;
    for (const d of readdirSync(pasta)) {
      const dir = join(pasta, d);
      if (!statSync(dir).isDirectory()) continue;
      for (const n of readdirSync(dir).filter((x) => x.endsWith(".css"))) {
        for (const m of readFileSync(join(dir, n), "utf8").matchAll(raizes)) {
          expect(m[1], `${d}/${n}`).not.toMatch(/(?:^|[;\s])(?:width|min-width)\s*:\s*\d+px/);
        }
      }
    }
  });
});

describe("contrato: toda tela declara o modo de layout", () => {
  it("MODO_DA_TELA cobre exatamente as telas da casca", () => {
    expect(Object.keys(MODO_DA_TELA).sort()).toEqual(TELAS.map((t) => t.id).sort());
  });

  // mapa e conhecimento: o renderizador de grafos está sendo refeito por outro agente; o CSS do contêiner externo já é cheio (height: 100%)
  const SEM_ATRIBUTO = new Set(["mapa", "conhecimento"]);

  for (const t of TELAS) {
    it(`tela ${t.id}`, () => {
      const decl = MODO_DA_TELA[t.id];
      expect(["leitura", "painel", "cheia"]).toContain(decl.modo);
      const dir = join(RENDERER, "telas", t.id);
      const src = fontes(dir);
      if (src.includes("<Pagina ")) {
        for (const m of src.matchAll(/<Pagina\s[^>]*>/g)) expect(m[0], "Pagina sem modo").toMatch(/modo="(leitura|painel|cheia)"/);
        expect(src).toContain(`modo="${decl.modo}"`);
      } else {
        expect(SEM_PAGINA[t.id], `${t.id} precisa de justificativa em SEM_PAGINA`).toBeTruthy();
        if (SEM_ATRIBUTO.has(t.id)) {
          const cssRaiz = readFileSync(join(dir, `${t.id === "mapa" ? "mapa" : "conhecimento"}.css`), "utf8");
          expect(cssRaiz).toMatch(/^\.(mapa|conhecimento)\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/m);
        } else {
          expect(src).toContain(`data-modo="${decl.modo}"`);
        }
      }
    });
  }
});
