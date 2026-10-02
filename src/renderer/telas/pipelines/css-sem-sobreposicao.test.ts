import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regressão da sobreposição de texto em "Parâmetros por nível" e "Hooks por nível" (valores longos sem ponto de quebra, grid sem minmax(0, ...)).
const css = readFileSync(join(__dirname, "pipelines.css"), "utf8");
const regras = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ seletor: m[1]!.trim(), corpo: m[2]! }));
const dos = (re: RegExp) => regras.filter((r) => re.test(r.seletor));
const ALVOS = /\.pl-param|\.pl-hook|\.pl-hooks/;

describe("css de parâmetros e hooks por nível: nada pode se sobrepor", () => {
  it("nenhuma regra desses blocos usa position absolute/fixed nem white-space: nowrap (exceto o selo curto do modo do hook)", () => {
    for (const r of dos(ALVOS)) {
      expect(r.corpo, r.seletor).not.toMatch(/position:\s*(absolute|fixed)/);
      if (!/\.pl-hook-modo/.test(r.seletor)) expect(r.corpo, r.seletor).not.toMatch(/white-space:\s*nowrap/);
      expect(r.corpo, r.seletor).not.toMatch(/text-overflow:\s*ellipsis/);
    }
  });
  it("a matriz de parâmetros tem layout fixo e quebra de palavra nas células", () => {
    expect(dos(/^\.pl-param$/).map((r) => r.corpo).join("")).toMatch(/table-layout:\s*fixed/);
    expect(css).toMatch(/\.pl-tabela th, \.pl-tabela td \{[^}]*overflow-wrap:\s*anywhere/);
    expect(dos(/\.pl-param td/).map((r) => r.corpo).join("")).toMatch(/overflow-wrap:\s*break-word/);
  });
  it("hooks: nome mono e descrição quebram; a grade usa minmax(min(100%, ...)) e os itens podem encolher", () => {
    expect(dos(/^\.pl-hook-nome$/)[0]?.corpo).toMatch(/overflow-wrap:\s*anywhere/);
    expect(dos(/^\.pl-hook-desc$/)[0]?.corpo).toMatch(/overflow-wrap:\s*break-word/);
    expect(dos(/^\.pl-hooks-lista$/)[0]?.corpo).toMatch(/minmax\(min\(100%,\s*\d+px\),\s*1fr\)/);
    expect(dos(/^\.pl-hook$/)[0]?.corpo).toMatch(/min-width:\s*0/);
  });
  it("em largura estreita a matriz dá lugar a um cartão por parâmetro (sem rolagem lateral)", () => {
    expect(css).toMatch(/@media \(max-width: 1000px\) \{[^@]*\.pl-param-tabela \{ display: none; \}[^@]*\.pl-param-lista \{ display: block; \}/);
  });
  it("linhas e fontes confortáveis: células com altura mínima de linha e texto secundário nunca abaixo de 12.5 px", () => {
    expect(dos(/^\.pl-param th, \.pl-param td$/)[0]?.corpo).toMatch(/min-height:\s*var\(--linha-altura\)/);
    expect(dos(/^\.pl-hook$/)[0]?.corpo).toMatch(/min-height:\s*var\(--linha-altura\)/);
    for (const r of dos(ALVOS)) for (const m of r.corpo.matchAll(/font-size:\s*([\d.]+)px/g)) expect(Number(m[1]), r.seletor).toBeGreaterThanOrEqual(12.5);
  });
});
