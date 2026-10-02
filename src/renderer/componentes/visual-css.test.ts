import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regras da auditoria visual (docs/ade/AUDITORIA-VISUAL.md) que o teste `conforto-css` ainda não cobria.
 * Estático: lê os CSS e os TSX das telas; nada de DOM.
 */
const RAIZ = resolve(__dirname, "..");

function arquivos(dir: string, ext: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "assets") arquivos(p, ext, acc); } else if (p.endsWith(ext) && !p.endsWith(`.test${ext}`)) acc.push(p);
  }
  return acc;
}
const rel = (p: string): string => relative(RAIZ, p).split("\\").join("/");
const semComentarios = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "");
const ler = (p: string): string => semComentarios(readFileSync(p, "utf8"));
const css = arquivos(RAIZ, ".css");
const cssTelas = css.filter((f) => rel(f).startsWith("telas/"));

/** Regras simples `seletor { corpo }` (sem aninhamento), com o seletor e o corpo. */
function regras(fonte: string): Array<{ seletor: string; corpo: string }> {
  const out: Array<{ seletor: string; corpo: string }> = [];
  for (const m of fonte.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ seletor: m[1]!.trim(), corpo: m[2]! });
  return out;
}

describe("auditoria visual: CSS compartilhado", () => {
  it("nenhuma classe de topo é definida em dois arquivos CSS (o bundle é global: `.vc-grupo` da Config herdava o layout do Versionamento)", () => {
    const conhecidas = new Set(["alertas-check", "alertas-sev", "ini-grade", "pagina", "pl-erro", "seletor-ws", "terminais-tela"]);
    const donos = new Map<string, Set<string>>();
    for (const f of css) {
      for (const m of ler(f).matchAll(/(?:^|\})\s*\.([a-zA-Z][\w-]*)\s*(?:\{|,)/g)) {
        const nome = m[1]!;
        donos.set(nome, (donos.get(nome) ?? new Set()).add(rel(f)));
      }
    }
    const colisoes = [...donos].filter(([n, s]) => s.size > 1 && !conhecidas.has(n)).map(([n, s]) => `${n}: ${[...s].join(", ")}`);
    expect(colisoes).toEqual([]);
  });

  it("telas não usam caixa alta em rótulos (text-transform: uppercase): títulos e cabeçalhos em caixa de frase", () => {
    const infratores = cssTelas.filter((f) => /text-transform:\s*uppercase/.test(ler(f))).map(rel);
    expect(infratores).toEqual([]);
  });

  it("grades de linha e cabeçalho não usam coluna `auto`/`max-content` (cada linha é um grid próprio: a coluna desalinha do cabeçalho)", () => {
    const infratores: string[] = [];
    for (const f of cssTelas) {
      for (const r of regras(ler(f))) {
        const g = /grid-template-columns:\s*([^;]+);/.exec(r.corpo)?.[1];
        if (g === undefined || !/linha|cab|cofre|decisao/.test(r.seletor)) continue;
        if (/(^|\s)(auto|max-content)(\s|$)/.test(g.replace(/minmax\([^)]*\)/g, ""))) infratores.push(`${rel(f)}: ${r.seletor}`);
      }
    }
    expect(infratores).toEqual([]);
  });

  it("canvas do grafo 3D: nenhum texto abaixo de 11.5 px e controles com alvo de 32 px", () => {
    const g = ler(join(RAIZ, "componentes/grafo3d/grafo3d.css"));
    const tamanhos = [...g.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
    expect(tamanhos.filter((t) => t < 11.5)).toEqual([]);
    expect(g).not.toMatch(/var\(--botao-icone,\s*22px\)/);
  });

  it("nenhuma regra de telas fixa altura entre 16 e 31 px em botão/campo/seletor (alvo mínimo é 32 px: use --botao-altura, --campo-altura ou --alvo-minimo)", () => {
    const infratores: string[] = [];
    for (const f of cssTelas) {
      if (rel(f).startsWith("telas/terminais/") || rel(f).startsWith("telas/agil/") || rel(f).startsWith("telas/pipelines/")) continue;
      for (const r of regras(ler(f))) {
        if (!/(btn|botao|button|mini|select|input|campo|seletor|icone-btn)/.test(r.seletor) || / \.icone$/.test(r.seletor)) continue;
        for (const m of r.corpo.matchAll(/(?:^|;)\s*(?:min-)?height:\s*(\d+)px/g)) {
          const n = Number(m[1]);
          if (n >= 16 && n < 32) infratores.push(`${rel(f)}: ${r.seletor} { height ${n}px }`);
        }
      }
    }
    expect(infratores).toEqual([]);
  });

  it("Mapa e Conhecimento declaram data-modo=\"cheia\" na raiz (sem ele herdam os tokens densos de 26 px) e o painel do Mapa é flex para o grafo ocupar a altura", () => {
    expect(readFileSync(join(RAIZ, "telas/mapa/Mapa.tsx"), "utf8")).toMatch(/className="mapa" data-modo="cheia"/);
    expect(readFileSync(join(RAIZ, "telas/conhecimento/Conhecimento.tsx"), "utf8")).toMatch(/className="conhecimento" data-modo="cheia"/);
    const mapa = ler(join(RAIZ, "telas/mapa/mapa.css"));
    expect(regras(mapa).find((r) => r.seletor === ".mp-painel-raiz")?.corpo).toMatch(/display:\s*flex/);
  });

  it("botão primário desativado fica legível (neutro, sem opacidade 0.5 sobre o azul) e <small> respeita o piso de 11.5 px", () => {
    const comp = ler(join(RAIZ, "componentes/componentes.css"));
    const desativado = regras(comp).find((r) => r.seletor === ".botao-primario:disabled")?.corpo ?? "";
    expect(desativado).toMatch(/opacity:\s*1/);
    expect(desativado).toMatch(/background:\s*var\(--superficie-2\)/);
    expect(ler(join(RAIZ, "componentes/conforto.css"))).toMatch(/small\s*\{\s*font-size:\s*max\(0\.85em,\s*var\(--fs-micro\)\)/);
  });
});
