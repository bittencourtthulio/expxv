import { describe, expect, it } from "vitest";
import { abrirArmazem } from "../armazem";
import type { Extracao } from "../tipos";
import { VERSAO_EXTRATOR } from "../tipos";
import { alcance, candidatosCostura, caminhoMinimo } from "./alcance";
import { niveisTopologicos } from "./camadas";
import { ciclos, componentesFortes } from "./ciclos";
import { construirGrafo, grafoDoArmazem, type ArestaGrafo } from "./memoria";
import { metricasDoNo } from "./metricas-grafo";
import { pageRank } from "./pagerank";

const FATOR = Number(process.env["EXPXV_PERF_FATOR"] ?? "1");
const ar = (de: string, para: string, extra: Partial<ArestaGrafo> = {}): ArestaGrafo => ({ de, para, tipo: "importa", ...extra });

// Gerador pseudoaleatório determinístico.
function lcg(semente: number): () => number {
  let s = semente >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** Implementação ingênua: alcançabilidade por Floyd-Warshall em conjuntos; SCC = mútua alcançabilidade. */
function sccIngenuo(n: number, arestas: Array<[number, number]>): number[] {
  const r = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j));
  for (const [a, b] of arestas) r[a]![b] = true;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) if (r[i]![k]) for (let j = 0; j < n; j++) if (r[k]![j]) r[i]![j] = true;
  const rep = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) if (r[i]![j] && r[j]![i]) { rep[i] = j; break; }
  return rep;
}

describe("construção", () => {
  it("funde paralelas, descarta laços, cria nós citados e filtra tipo e confiança", () => {
    const g = construirGrafo(["a"], [ar("a", "b"), ar("a", "b", { peso: 2, confianca: "heuristica" }), ar("a", "a"), ar("b", "c", { tipo: "chama", confianca: "heuristica" })]);
    expect(g.n).toBe(3);
    expect(g.m).toBe(2);
    expect(g.lacos).toBe(1);
    expect(g.saidaPeso[g.saidaOff[g.indice("a")]!]).toBe(3);
    expect(g.saidaExata[g.saidaOff[g.indice("a")]!]).toBe(1);
    expect(construirGrafo([], [ar("a", "b"), ar("b", "c", { tipo: "chama" })], { tipos: ["importa"] }).m).toBe(1);
    expect(construirGrafo([], [ar("a", "b", { confianca: "heuristica" })], { minConfianca: "exata" }).m).toBe(0);
    expect(g.indice("zzz")).toBe(-1);
  });

  it("vem do armazém real (nós e arestas gravados)", () => {
    const armazem = abrirArmazem({ caminho: ":memory:" });
    const ex = (): Extracao => ({ versao_extrator: VERSAO_EXTRATOR, linguagem: "typescript", hash: "h", loc: 1, loc_codigo: 1, loc_comentario: 0, complexidade_total: 0, complexidade_max: 0, erros_parse: 0, e_teste: false, e_gerado: false, truncado: false, simbolos: [], imports: [], chamadas: [], herancas: [], entradas: [], dados: [], padroes: [], dinamicos: [] });
    armazem.gravarLote([
      { caminho: "a.ts", linguagem: "typescript", hash: "1", tamanho: 1, mtime_ms: 1, extracao: ex() },
      { caminho: "b.ts", linguagem: "typescript", hash: "2", tamanho: 1, mtime_ms: 1, extracao: ex() },
    ]);
    armazem.substituirArestas({ tipos: ["importa"] }, [{ tipo: "importa", de: "arq:a.ts", para: "arq:b.ts", confianca: "exata", peso: 1, candidatos: null, fonte: "extracao", arquivo_id: null, linha: 1, evidencias: null }]);
    const g = grafoDoArmazem(armazem);
    expect(g.indice("arq:a.ts")).toBeGreaterThanOrEqual(0);
    expect(g.m).toBe(1);
    armazem.fechar();
  });
});

describe("Tarjan", () => {
  it("ciclo dentro de ciclo, ciclos disjuntos e grafo sem arestas", () => {
    const g = construirGrafo([], [ar("a", "b"), ar("b", "c"), ar("c", "a"), ar("c", "d"), ar("d", "e"), ar("e", "d", { peso: 5 }), ar("b", "a")]);
    const cs = ciclos(g);
    expect(cs.map((c) => c.nos.map((i) => g.ids[i]))).toEqual([["a", "b", "c"], ["d", "e"]]);
    expect(cs[0]!.quebrar[0]).toMatchObject({ peso: 1 });
    expect(ciclos(construirGrafo(["x", "y"], [])).length).toBe(0);
  });

  it("concorda com a implementação ingênua em grafos aleatórios (semente fixa)", () => {
    for (let semente = 1; semente <= 25; semente++) {
      const rnd = lcg(semente);
      const n = 12;
      const arestas: Array<[number, number]> = [];
      for (let k = 0; k < 20; k++) {
        const a = Math.floor(rnd() * n);
        const b = Math.floor(rnd() * n);
        if (a !== b) arestas.push([a, b]);
      }
      const g = construirGrafo(Array.from({ length: n }, (_, i) => String(i)), arestas.map(([a, b]) => ar(String(a), String(b))));
      const { componente } = componentesFortes(g);
      const ing = sccIngenuo(n, arestas);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) expect(componente[g.indice(String(i))] === componente[g.indice(String(j))], `semente ${semente}`).toBe(ing[i] === ing[j]);
    }
  });

  it("cadeia de 50 000 nós não estoura a pilha (e fecha num ciclo gigante)", () => {
    const n = 50_000;
    const nos = Array.from({ length: n }, (_, i) => `n${i}`);
    const cadeia = nos.slice(1).map((id, i) => ar(`n${i}`, id));
    const g = construirGrafo(nos, cadeia);
    expect(componentesFortes(g).total).toBe(n);
    expect(niveisTopologicos(g).maximo).toBe(n - 1);
    const fechado = construirGrafo(nos, [...cadeia, ar(`n${n - 1}`, "n0")]);
    expect(ciclos(fechado)[0]!.tamanho).toBe(n);
    expect(alcance(g, 0).nos.length).toBe(n - 1);
  });
});

describe("orçamentos P-246 (melhor de 5 execuções, fator EXPXV_PERF_FATOR)", () => {
  const rnd = lcg(7);
  const N = 5000;
  const nos = Array.from({ length: N }, (_, i) => `n${i}`);
  const arestas: ArestaGrafo[] = [];
  while (arestas.length < 15_000) {
    const a = Math.floor(rnd() * N);
    const b = Math.floor(rnd() * N);
    if (a !== b) arestas.push(ar(`n${a}`, `n${b}`));
  }
  const g = construirGrafo(nos, arestas);
  const melhor = (fn: () => void): number => {
    let m = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      fn();
      m = Math.min(m, performance.now() - t0);
    }
    return m;
  };
  it("Tarjan 5 000/15 000 <= 30 ms", () => {
    const ms = melhor(() => componentesFortes(g));
    console.log(`P-246 Tarjan: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThanOrEqual(30 * FATOR);
  });
  it("PageRank 5 000/15 000 <= 100 ms", () => {
    const ms = melhor(() => pageRank(g));
    console.log(`P-246 PageRank: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThanOrEqual(100 * FATOR);
  });
});

describe("PageRank", () => {
  it("soma 1, o mais referenciado lidera e o nó sem saída não vaza massa", () => {
    const g = construirGrafo([], [ar("a", "hub"), ar("b", "hub"), ar("c", "hub"), ar("hub", "d")]);
    const r = pageRank(g);
    expect(r.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
    const topo = [...r].indexOf(Math.max(...r));
    expect(g.ids[topo]).toBe("d");
    expect(r[g.indice("hub")]!).toBeGreaterThan(r[g.indice("a")]!);
  });
  it("personalização desloca a massa para a semente; grafo vazio devolve vazio", () => {
    const g = construirGrafo([], [ar("a", "b"), ar("c", "d")]);
    const r = pageRank(g, { personalizacao: new Map([[g.indice("c"), 1]]) });
    expect(r[g.indice("d")]!).toBeGreaterThan(r[g.indice("b")]!);
    expect(pageRank(construirGrafo([], [])).length).toBe(0);
  });
});

describe("alcance, caminhos e costuras", () => {
  const g = construirGrafo([], [ar("e1", "x"), ar("e2", "x"), ar("x", "y"), ar("y", "z"), ar("x", "w", { confianca: "heuristica" }), ar("w", "z")]);
  it("BFS direta e reversa com profundidade, teto e filtro de confiança", () => {
    const i = (id: string): number => g.indice(id);
    expect([...alcance(g, i("e1")).nos].map((v) => g.ids[v]).sort()).toEqual(["w", "x", "y", "z"]);
    expect(alcance(g, i("e1"), { profundidade: 1 }).nos.length).toBe(1);
    expect(alcance(g, i("e1"), { maxNos: 2 }).truncado).toBe(true);
    expect([...alcance(g, i("e1"), { minConfianca: "exata" }).nos].map((v) => g.ids[v]).sort()).toEqual(["x", "y", "z"]);
    expect([...alcance(g, i("z"), { direcao: "entrada" }).nos].map((v) => g.ids[v]).sort()).toEqual(["e1", "e2", "w", "x", "y"]);
    expect(alcance(g, i("z")).nos.length).toBe(0);
  });
  it("caminho mínimo e candidatos a costura (interseção dos caminhos)", () => {
    const i = (id: string): number => g.indice(id);
    expect(caminhoMinimo(g, i("e1"), i("z"))).toHaveLength(4); // empate y/w: o de menor índice, determinístico
    expect(caminhoMinimo(g, i("z"), i("e1"))).toBeNull();
    expect(caminhoMinimo(g, i("e1"), i("z"), { minConfianca: "exata" })?.map((v) => g.ids[v])).toEqual(["e1", "x", "y", "z"]);
    expect(candidatosCostura(g, [i("e1"), i("e2")], i("z")).map((v) => g.ids[v])).toEqual(["y", "x"]); // mais perto do alvo primeiro
  });
});

describe("níveis e métricas", () => {
  it("níveis da condensação: ciclo compartilha nível; base = 0", () => {
    const g = construirGrafo([], [ar("ui", "svc"), ar("svc", "repo"), ar("repo", "svc"), ar("repo", "db")]);
    const { nivel, maximo } = niveisTopologicos(g);
    const n = (id: string): number => nivel[g.indice(id)]!;
    expect([n("db"), n("svc"), n("repo"), n("ui")]).toEqual([0, 1, 1, 2]);
    expect(maximo).toBe(2);
  });
  it("fan-in, fan-out e instabilidade", () => {
    const g = construirGrafo(["solo"], [ar("a", "b"), ar("c", "b"), ar("b", "d")]);
    expect(metricasDoNo(g, g.indice("b"))).toEqual({ ca: 2, ce: 1, instabilidade: 1 / 3 });
    expect(metricasDoNo(g, g.indice("solo")).instabilidade).toBe(0);
  });
});
