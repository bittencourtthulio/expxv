import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrato "sub-navegação lateral" (docs/ade/04-UI-UX.md): nenhuma tela com várias seções põe abas EM CIMA.
 * Seções navegam pela barra lateral do componente `SubNavegacao`. Só as abas de Panes das áreas de terminal ficam de fora.
 */
const RAIZ = join(__dirname);
const EXCECOES: Readonly<Record<string, string>> = {
  "terminais/": "abas de Panes e Grade/Abas de terminal: área aprovada pelo dono (D-32)",
};

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho];
  });
}
const fontes = arquivos(RAIZ).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && !/fabrica-teste/.test(f));
const rel = (f: string): string => relative(RAIZ, f).split(sep).join("/");
const excecao = (f: string): boolean => Object.keys(EXCECOES).some((p) => rel(f).startsWith(p));

describe("contrato: sub-navegação lateral", () => {
  it("nenhuma tela (fora das exceções) declara role=\"tablist\" próprio: abas só pelo componente SubNavegacao", () => {
    const infratores = fontes.filter((f) => !excecao(f) && /role=["{]+\s*["']?tablist/.test(readFileSync(f, "utf8"))).map(rel);
    expect(infratores).toEqual([]);
  });
  it("ninguém usa role=\"tab\" solto fora do componente e das exceções", () => {
    const infratores = fontes.filter((f) => !excecao(f) && /role="tab"/.test(readFileSync(f, "utf8"))).map(rel);
    expect(infratores).toEqual([]);
  });
  it("o componente de abas horizontais antigo não existe mais", () => {
    const todos = arquivos(join(RAIZ, "..")).filter((f) => /\.(tsx?|css)$/.test(f));
    expect(todos.filter((f) => /ListaAbas/.test(readFileSync(f, "utf8")) && !/sub-navegacao-contrato/.test(f)).map(rel)).toEqual([]);
  });
  it("as telas convertidas usam SubNavegacao", () => {
    const esperadas = ["agil/Agil", "consumo/index", "harness/index", "alertas/index", "jarvis/index", "pipelines/Pipelines", "mapa/Mapa", "conhecimento/Conhecimento", "memoria/Memoria", "relatorios/Relatorios", "catalogo/index", "metodo/index", "metodo/Trabalho", "versionamento/index", "versionamento/Branches", "missoes/index", "config/index"];
    const sem = esperadas.filter((e) => !/<SubNavegacao/.test(readFileSync(join(RAIZ, `${e}.tsx`), "utf8")));
    expect(sem).toEqual([]);
  });
  it("a sidebar do componente é vertical (aria-orientation) e as exceções estão justificadas", () => {
    const comp = readFileSync(join(RAIZ, "..", "componentes", "SubNavegacao.tsx"), "utf8");
    expect(comp).toMatch(/aria-orientation/);
    expect(comp).toMatch(/role="tablist"/);
    for (const [p, motivo] of Object.entries(EXCECOES)) expect(motivo.length).toBeGreaterThan(10), expect(p.endsWith("/")).toBe(true);
  });
});
