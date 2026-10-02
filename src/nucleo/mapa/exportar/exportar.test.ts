import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FluxoMapaIpc, GrafoMapaIpc, NoGrafoMapa, ResumoMapaIpc } from "../../../compartilhado/mapa";
import { CONFIG_MAPA_PADRAO } from "../../../compartilhado/mapa";
import { celulaCsv, destinoPermitido, exportarCsv, exportarDot, exportarJson, exportarMarkdown, exportarMermaid, exportarSvg, gerarExportacao, gravarExportacao, MENSAGEM_DESTINO_DOCS } from "./index";

const pastas: string[] = [];
afterEach(() => { for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true }); });
const tmp = (): string => { const p = mkdtempSync(join(tmpdir(), "mapa-exp-")); pastas.push(p); return p; };

function grafo(n: number, modulos = 10): GrafoMapaIpc {
  const nos: NoGrafoMapa[] = Array.from({ length: n }, (_, i) => ({ id: `arq:m${i % modulos}/f${i}.ts`, r: `f${i}.ts`, t: "arquivo", g: `m${i % modulos}`, w: 10 }));
  const arestas: GrafoMapaIpc["arestas"] = [];
  for (let i = 1; i < n; i++) arestas.push([i, Math.floor(i / 2), i % 7 === 0 ? "chama" : "importa", i % 7 === 0 ? 0 : 1, 1]);
  return { nivel: "arquivo", nos, arestas, truncado: false, total_nos: n, total_arestas: arestas.length, versao_mapa: 3 };
}
const pequeno: GrafoMapaIpc = {
  nivel: "arquivo", versao_mapa: 1, truncado: false, total_nos: 3, total_arestas: 2,
  nos: [
    { id: "arq:a/x.ts", r: 'x "q" <b> [y]', t: "arquivo", g: "a", w: 5 },
    { id: "arq:b/y.ts", r: "y.ts", t: "arquivo", g: "b", w: 5 },
    { id: "arq:b/z.ts", r: "=cmd()", t: "arquivo", g: "b", w: 5 },
  ],
  arestas: [[0, 1, "importa", 1, 2], [1, 2, "chama", 0, 1]],
};
const fluxo: FluxoMapaIpc = {
  raiz: "ent:src/r.ts#GET /u", tabelas: ["users"], externos: [], truncado: false,
  nos: [
    { id: "ent:src/r.ts#GET /u", rotulo: "GET /u", tipo: "entrada", nivel: 0, tracejado: false, externo: false, em_ciclo: false, tabelas: [], caminho: "src/r.ts", linha: 3 },
    { id: "sim:src/s.ts#lista", rotulo: "lista", tipo: "simbolo", nivel: 1, tracejado: true, externo: false, em_ciclo: false, tabelas: ["users"], caminho: "src/s.ts", linha: 9 },
  ],
  arestas: [["ent:src/r.ts#GET /u", "sim:src/s.ts#lista", "aciona", 0, 0]],
};

function xmlBalanceado(xml: string): boolean {
  const pilha: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    if (m[3] === "/") continue;
    if (m[1] === "/") { if (pilha.pop() !== m[2]) return false; } else pilha.push(m[2] as string);
  }
  return pilha.length === 0;
}

describe("mermaid", () => {
  it("gabarito do fluxo (heurística tracejada)", () => {
    expect(exportarMermaid(fluxo)).toBe('flowchart LR\n  n0["GET /u"]\n  n1["lista"]\n  n0 -.->|aciona| n1\n');
  });
  it("escapa aspas, colchetes e delimitadores; ids únicos", () => {
    const m = exportarMermaid(pequeno);
    expect(m).toContain('n0["x #quot;q#quot; #lt;b#gt; #91;y#93;"]');
    expect(m).toContain("n1 -.->|chama| n2");
    const ids = [...m.matchAll(/^ {2}(n\d+)\[/gm)].map((x) => x[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("acima do teto agrupa por módulo e avisa", () => {
    const m = exportarMermaid(grafo(400, 8), { maxNos: 300 });
    expect(m).toContain("agrupado por módulo");
    expect((m.match(/^ {2}n\d+\[/gm) ?? []).length).toBe(8);
  });
});

describe("dot", () => {
  it("cluster por módulo, escape e tracejado", () => {
    const d = exportarDot(pequeno);
    expect(d).toContain("digraph mapa {");
    expect(d).toContain("rankdir=LR;");
    expect(d).toContain("subgraph cluster_0");
    expect(d).toContain('label="x \\"q\\" <b> [y]"');
    expect(d).toContain("style=dashed");
    expect((d.match(/\{/g) ?? []).length).toBe((d.match(/\}/g) ?? []).length);
  });
});

describe("svg", () => {
  it("XML bem formado, cores por parâmetro e recusa de cor perigosa", () => {
    const s = exportarSvg(pequeno, { cores: { fundo: "#101010", no: '"/><script>x</script>' } });
    expect(s.startsWith("<?xml")).toBe(true);
    expect(s).toContain('fill="#101010"');
    expect(s).not.toContain("<script>");
    expect(s).toContain("&lt;b&gt;");
    expect(s).toContain("stroke-dasharray");
    expect(xmlBalanceado(s)).toBe(true);
  });
  it("ciclo puro não trava o layout", () => {
    const g: GrafoMapaIpc = { ...pequeno, nos: pequeno.nos.slice(0, 2), arestas: [[0, 1, "importa", 1, 1], [1, 0, "importa", 1, 1]] };
    expect(exportarSvg(g)).toContain("</svg>");
  });
});

describe("json e csv", () => {
  it("json tem schema_version, nos, arestas e métricas", () => {
    const j = JSON.parse(exportarJson(pequeno)) as { schema_version: number; nos: unknown[]; arestas: unknown[]; metricas: { exatas: number; heuristicas: number } };
    expect(j.schema_version).toBe(1);
    expect(j.nos).toHaveLength(3);
    expect(j.metricas).toMatchObject({ exatas: 1, heuristicas: 1 });
  });
  it("csv RFC 4180 e injeção de fórmula neutralizada", () => {
    expect(celulaCsv("a,b")).toBe('"a,b"');
    expect(celulaCsv('a"b')).toBe('"a""b"');
    expect(celulaCsv("=1+1")).toBe("'=1+1");
    expect(celulaCsv("@x")).toBe("'@x");
    const c = exportarCsv(pequeno);
    expect(c["nos.csv"]).toContain("'=cmd()");
    expect(c["nos.csv"].split("\r\n")[0]).toBe("id,rotulo,tipo,grupo,peso");
    expect(c["arestas.csv"]).toContain("heuristica");
  });
});

describe("markdown", () => {
  const resumo: ResumoMapaIpc = {
    estado: "pronto", versao_mapa: 2, analisado_em: "2026-10-01T00:00:00Z", arquivos: 10, nos: 30, linguagens: [{ linguagem: "typescript", arquivos: 10, loc: 1200 }],
    arestas: { exata: 8, heuristica: 2 }, historia: "ok", ferramentas: { ctags: false, scc: false, dot: false }, desatualizado: false, alterados_n: 0, degradadas: 0,
    analisando: false, progresso: null, configuracao: { ...CONFIG_MAPA_PADRAO }, aviso: null, pacote: { carimbo: null, caminho: null }, estimativa_arquivos: null,
  };
  it("código sem uso aparece só como candidato", () => {
    const md = exportarMarkdown({
      resumo, mortos: { rotulo: "candidato a código morto (verificar antes de qualquer remoção)", itens: [{ id: "arq:a.ts", tipo: "arquivo", caminho: "a.ts", linha: null, confianca: "media", motivos: ["sem importadores"] }] },
      ciclos: { total: 0, ciclos: [] },
    });
    expect(md).toContain("Candidatos a código morto");
    expect(md).not.toMatch(/(?<!candidatos? a código )morto/i);
    expect(md).toContain("Confiança e limites");
  });
});

describe("destino e gravação", () => {
  it("recusa docs/, inclusive via .. e symlink", () => {
    const raiz = tmp();
    mkdirSync(join(raiz, "docs", "sub"), { recursive: true });
    mkdirSync(join(raiz, "fora"));
    symlinkSync(join(raiz, "docs"), join(raiz, "fora", "atalho"));
    for (const d of [join(raiz, "docs"), join(raiz, "docs", "sub", "x"), join(raiz, "fora", "..", "docs", "a"), join(raiz, "fora", "atalho", "n"), "docs/z", join(raiz, "DOCS", "q")]) {
      const r = destinoPermitido(raiz, d);
      expect(r, d).toEqual({ ok: false, erro: MENSAGEM_DESTINO_DOCS });
    }
    expect(destinoPermitido(raiz, join(raiz, "fora", "ok")).ok).toBe(true);
    expect(destinoPermitido(raiz, join(raiz, "docsx")).ok).toBe(true);
  });
  it("grava atômico, valida nomes e não deixa .tmp", () => {
    const raiz = tmp();
    const r = gravarExportacao({ raiz, pasta: join(raiz, "saida"), arquivos: gerarExportacao({ formato: "csv", vista: pequeno }) });
    expect(r.caminhos).toHaveLength(2);
    expect(readdirSync(join(raiz, "saida")).sort()).toEqual(["arestas.csv", "nos.csv"]);
    expect(() => gravarExportacao({ raiz, pasta: join(raiz, "docs"), arquivos: { "a.md": "x" } })).toThrow(MENSAGEM_DESTINO_DOCS);
    expect(() => gravarExportacao({ raiz, pasta: join(raiz, "s2"), arquivos: { "../x.md": "x" } })).toThrow(/nome de arquivo inválido/);
    expect(readFileSync(join(raiz, "saida", "nos.csv"), "utf8")).toContain("arq:a/x.ts");
    writeFileSync(join(raiz, "ok"), "");
  });
});

describe("P-251: 500 nós em <= 300 ms (melhor de 3)", () => {
  it.each([["mermaid", exportarMermaid], ["dot", exportarDot], ["svg", exportarSvg]] as const)("%s", (_n, f) => {
    const g = grafo(500, 500); // sem agrupar: 500 > 300 agrupa; força teto alto
    let melhor = Infinity;
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      (f as (v: GrafoMapaIpc, o: { maxNos: number }) => string)(g, { maxNos: 1000 });
      melhor = Math.min(melhor, performance.now() - t);
    }
    expect(melhor).toBeLessThan(300);
  });
});
