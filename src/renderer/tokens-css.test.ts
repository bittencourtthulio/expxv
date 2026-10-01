import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { COR_FUNDO_JANELA } from "../compartilhado/tema";

const RAIZ = __dirname;
const tokens = readFileSync(join(RAIZ, "tokens.css"), "utf8");

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome !== "assets") arquivos(caminho, acc);
    } else acc.push(caminho);
  }
  return acc;
}

function bloco(css: string, seletor: string): string {
  const inicio = css.indexOf(seletor);
  if (inicio < 0) return "";
  const abre = css.indexOf("{", inicio);
  return css.slice(abre + 1, css.indexOf("}", abre));
}

const nomes = (b: string) => [...b.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!).sort();
const valor = (b: string, nome: string) => new RegExp(`${nome}\\s*:\\s*([^;]+);`).exec(b)?.[1]?.trim();

describe("tokens.css", () => {
  it("os dois temas definem exatamente o mesmo conjunto de tokens", () => {
    const escuro = nomes(bloco(tokens, ':root[data-theme="escuro"]'));
    const claro = nomes(bloco(tokens, ':root[data-theme="claro"]'));
    expect(escuro.length).toBeGreaterThan(10);
    expect(claro).toEqual(escuro);
  });

  it("--fundo de cada tema é igual à cor de fundo da janela do main", () => {
    for (const tema of ["escuro", "claro"] as const) {
      const b = bloco(tokens, `:root[data-theme="${tema}"]`);
      expect(valor(b, "--fundo")?.toLowerCase()).toBe(COR_FUNDO_JANELA[tema]);
    }
  });

  it("topo e rodapé não usam backdrop-filter (nem em lugar nenhum da casca)", () => {
    const css = arquivos(RAIZ).filter((c) => c.endsWith(".css"));
    for (const c of css) expect(readFileSync(c, "utf8")).not.toMatch(/backdrop-filter/);
    const casca = readFileSync(join(RAIZ, "casca/casca.css"), "utf8");
    expect(casca).toMatch(/\.casca-topo/);
    expect(casca).toMatch(/\.rodape/);
  });

  it("nenhuma cor literal fora de tokens.css e do tema do xterm", () => {
    const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/;
    const vazamentos = arquivos(RAIZ)
      .filter((c) => /\.(css|ts|tsx|html)$/.test(c))
      .filter((c) => !/\.test\.tsx?$/.test(c))
      .filter((c) => relative(RAIZ, c) !== "tokens.css" && !/tema-xterm\.ts$/.test(c))
      .filter((c) => literal.test(readFileSync(c, "utf8")))
      .map((c) => relative(RAIZ, c));
    expect(vazamentos).toEqual([]);
  });
});
