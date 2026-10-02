import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "..");
const conforto = readFileSync(join(RAIZ, "componentes/conforto.css"), "utf8");
const tokens = readFileSync(join(RAIZ, "tokens.css"), "utf8");

function css(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "assets") css(p, acc); } else if (p.endsWith(".css")) acc.push(p);
  }
  return acc;
}
function bloco(fonte: string, seletor: string): string {
  const i = fonte.indexOf(`${seletor} {`);
  if (i < 0) return "";
  const a = fonte.indexOf("{", i);
  return fonte.slice(a + 1, fonte.indexOf("}", a));
}
const valor = (b: string, nome: string) => new RegExp(`${nome}:\\s*([^;]+);`).exec(b)?.[1]?.trim();

/** Fora da escala de conforto, com a razão: terminal, casca, tema do xterm, overlays da casca, camada central e tokens. */
const EXCLUSOES: Record<string, string> = {
  "telas/terminais/": "área do terminal/trabalho, aprovada pelo dono e intocável",
  "componentes/Terminal/": "xterm e busca do terminal",
  "casca/": "menu lateral, topo e rodapé",
  "componentes/paleta.css": "paleta de comandos (overlay da casca)",
  "componentes/grafo3d/": "rótulos dentro de canvas de grafo",
  "componentes/VirtualLista.css": "sem tipografia",
  "tokens.css": "tokens",
  "fontes.css": "@font-face",
  "componentes/conforto.css": "a própria camada define os valores",
};
const excluido = (rel: string) => Object.keys(EXCLUSOES).some((e) => rel.startsWith(e));
/** Rótulos de gráficos SVG (escalam com o viewBox, como o canvas de grafo). */
const ROTULO_SVG = /svg|mp-fl|met-no\b|\.rot\b|g3d/;
const CONTROLE = /(^|[^\w-])(input|select|textarea|button)\b|\.botao\b|-(btn|botao)\b/;

describe("escala de conforto (CSS estático)", () => {
  const alvo = css(RAIZ).map((f) => ({ f, rel: relative(RAIZ, f) })).filter(({ rel }) => !excluido(rel));

  it("há telas varridas", () => expect(alvo.length).toBeGreaterThan(20));

  it("nenhum font-size literal abaixo de 11.5 px nas telas", () => {
    const ruins: string[] = [];
    for (const { f, rel } of alvo) {
      const s = readFileSync(f, "utf8");
      for (const r of s.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (ROTULO_SVG.test(r[1]!)) continue;
        for (const m of r[2]!.matchAll(/font-size:\s*([\d.]+)px|font:\s*(?:(?:italic|bold|[1-9]00)\s+)?([\d.]+)px/g)) {
          const n = Number(m[1] ?? m[2]);
          if (n < 11.5) ruins.push(`${rel}: ${r[1]!.trim().slice(0, 50)} ${m[0]}`);
        }
      }
    }
    expect(ruins).toEqual([]);
  });

  it("controles (input/select/textarea/button/.botao) não têm height/min-height literal abaixo de 32 px", () => {
    const ruins: string[] = [];
    for (const { f, rel } of alvo) {
      const s = readFileSync(f, "utf8");
      for (const r of s.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const ultimos = r[1]!.split(",").map((x) => x.trim().split(/\s+/).pop()!);
        if (!ultimos.some((u) => CONTROLE.test(` ${u}`))) continue;
        for (const d of r[2]!.matchAll(/(?:^|;)\s*((?:min-)?height)\s*:\s*([\d.]+)px/g)) {
          if (Number(d[2]) < 32) ruins.push(`${rel}: ${r[1]!.trim().slice(0, 60)} { ${d[1]}: ${d[2]}px }`);
        }
      }
    }
    expect(ruins).toEqual([]);
  });

  it("as exclusões têm justificativa", () => {
    for (const j of Object.values(EXCLUSOES)) expect(j.length).toBeGreaterThanOrEqual(6);
  });
});

describe("tokens de conforto", () => {
  const nomes = ["--fs-micro", "--fs-pequeno", "--fs-base", "--fs-titulo", "--campo-altura", "--botao-altura", "--espaco-1", "--espaco-2", "--espaco-3", "--espaco-4", "--espaco-5", "--espaco-6"];
  const raiz = bloco(conforto, ":root");
  const leitura = bloco(conforto, '[data-modo="leitura"], [data-modo="painel"], .dialogo-fundo');

  it("existem em :root (modo terminal) e são redefinidos em leitura e painel", () => {
    for (const n of nomes) {
      expect(valor(raiz, n), `${n} em :root`).toBeTruthy();
      expect(valor(leitura, n), `${n} em leitura/painel`).toBeTruthy();
    }
  });

  it("valores de conforto: texto 14, campo 36, botão 34/36, espaço 4/8/12/16/24/32, nada abaixo de 11.5", () => {
    expect(valor(leitura, "--fs-base")).toBe("14px");
    expect(valor(leitura, "--campo-altura")).toBe("36px");
    expect(valor(leitura, "--botao-altura")).toBe("34px");
    expect(valor(leitura, "--botao-principal-altura")).toBe("36px");
    expect(valor(leitura, "--botao-fonte")).toBe("13.5px");
    expect([1, 2, 3, 4, 5, 6].map((i) => valor(leitura, `--espaco-${i}`))).toEqual(["4px", "8px", "12px", "16px", "24px", "32px"]);
    expect(Number.parseFloat(valor(leitura, "--fs-micro")!)).toBeGreaterThanOrEqual(11.5);
  });

  it("o modo terminal mantém os valores atuais: --texto-base 13px e tokens do terminal intactos, sem redefinição global", () => {
    expect(valor(bloco(tokens, ":root"), "--texto-base")).toBe("13px");
    for (const [n, v] of [["--altura-barra", "28px"], ["--altura-aba", "24px"], ["--altura-cabecalho-painel", "18px"], ["--fonte-aba", "11px"], ["--fonte-cabecalho-painel", "10.5px"]] as const) {
      expect(valor(bloco(tokens, ":root"), n)).toBe(v);
    }
    expect(conforto).not.toMatch(/--texto-base|--fonte-aba|--altura-barra|--altura-aba|--fonte-cabecalho-painel|--altura-cabecalho-painel/);
    expect(valor(raiz, "--fs-base")).toBe("13px");
    expect(valor(raiz, "--fs-micro")).toBe("10.5px");
    expect(valor(raiz, "--fs-pequeno")).toBe("11.5px");
  });

  it("as telas cheias (exceto Terminais) sobem alvos para 32 px", () => {
    const cheia = bloco(conforto, '[data-modo="cheia"]:not(.terminais-tela)');
    expect(valor(cheia, "--campo-altura")).toBe("32px");
    expect(valor(cheia, "--botao-altura")).toBe("32px");
    expect(Number.parseFloat(valor(cheia, "--fs-micro")!)).toBeGreaterThanOrEqual(11.5);
  });

  it("foco visível de 2 px com offset 2 px e movimento reduzido respeitado", () => {
    expect(conforto).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--destaque\);\s*outline-offset:\s*2px/);
    expect(conforto).toContain("prefers-reduced-motion");
    expect(conforto).not.toMatch(/outline:\s*(none|0)/);
  });

  it("a tela Terminais fica fora das regras gerais de controles (abas e botões do terminal mantêm a medida compacta)", () => {
    // regressão: `min-height` de botão do conforto empurrava o texto das abas (24 px) para baixo e o cortava
    const regrasGerais = conforto.split("\n").filter((l) => (/^\s*:where\(\[data-modo\]/.test(l) && !l.includes(":focus-visible")) || /^\[data-modo\][^{]*\.botao-mini/.test(l));
    expect(regrasGerais.length).toBeGreaterThan(5);
    for (const l of regrasGerais) expect(l, l).toContain(":not(.terminais-tela)");
  });
});
