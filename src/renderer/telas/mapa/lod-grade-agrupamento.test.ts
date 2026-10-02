import { describe, expect, it } from "vitest";
import type { GrafoMapaIpc, NoGrafoMapa } from "../../../compartilhado/mapa";
import { agrupar, alternarExpansao, chaveGrupo, LIMIAR_AGRUPAR, modoEfetivo } from "./agrupamento";
import { contarFiltros, FILTROS_VAZIOS, filtrarLocal, paraFiltroIpc, pastaSegura } from "./filtros";
import { acharNaGrade, criarGrade } from "./grade";
import { escolherArestas, escolherRotulos, mostrarRotulos, nosVisiveis, retanguloVisivel, LIMITE_ARESTAS_VISIVEIS } from "./lod";

const no = (id: string, g: string, extra: Partial<NoGrafoMapa> = {}): NoGrafoMapa => ({ id, r: id, t: "arquivo", g, w: 10, ...extra });
const grafo = (nos: NoGrafoMapa[], arestas: GrafoMapaIpc["arestas"]): GrafoMapaIpc => ({ nivel: "arquivo", nos, arestas, truncado: false, total_nos: nos.length, total_arestas: arestas.length, versao_mapa: 1 });

describe("grade espacial", () => {
  it("acha o nó sob o ponto e ignora os distantes", () => {
    const xs = Float64Array.from([0, 100, -300]);
    const ys = Float64Array.from([0, 100, 5]);
    const g = criarGrade(xs, ys, Float64Array.from([6, 6, 6]));
    expect(acharNaGrade(g, 2, 1)).toBe(0);
    expect(acharNaGrade(g, 99, 103)).toBe(1);
    expect(acharNaGrade(g, -300, 5)).toBe(2);
    expect(acharNaGrade(g, 50, 50)).toBe(-1);
  });
});

describe("LOD", () => {
  it("rótulos só com zoom >= 0,8; seleção sempre rotulada", () => {
    expect(mostrarRotulos(0.79)).toBe(false);
    expect(mostrarRotulos(0.8)).toBe(true);
    const ids = ["a", "b", "c"];
    expect(escolherRotulos(ids, [1, 9, 5], [0, 1, 2], new Set([0]), 0.5)).toEqual([0]);
    expect(escolherRotulos(ids, [1, 9, 5], [0, 1, 2], new Set([0]), 1, 2)).toEqual([0, 1]);
  });
  it("culling por viewport", () => {
    const r = retanguloVisivel(0, 0, 1, 100, 100);
    expect(nosVisiveis(Float64Array.from([0, 49, 500]), Float64Array.from([0, 0, 0]), r, 0)).toEqual([0, 1]);
  });
  it("acima de 3 000 arestas visíveis só as da seleção", () => {
    const n = LIMITE_ARESTAS_VISIVEIS + 10;
    const de = Int32Array.from({ length: n }, (_, i) => i % 50);
    const para = Int32Array.from({ length: n }, (_, i) => (i + 1) % 50);
    const todos = new Set(Array.from({ length: 50 }, (_, i) => i));
    const r = escolherArestas(de, para, todos, new Set([3]));
    expect(r.reduzido).toBe(true);
    expect(r.indices.every((e) => de[e] === 3 || para[e] === 3)).toBe(true);
    expect(escolherArestas(de.slice(0, 10), para.slice(0, 10), todos, new Set()).reduzido).toBe(false);
  });
});

describe("agrupamento", () => {
  const g = grafo([no("arq:a/x.ts", "a"), no("arq:a/y.ts", "a", { c: 1 }), no("arq:b/z.ts", "b/c")], [[0, 1, "importa", 1, 1], [0, 2, "importa", 0, 2], [1, 2, "importa", 1, 3]]);
  it("modo arquivo não agrupa; módulo funde e soma arestas, preservando a heurística", () => {
    expect(agrupar(g, "arquivo", new Set()).agrupado).toBe(false);
    const m = agrupar(g, "modulo", new Set());
    expect(m.nos.map((n) => n.id)).toEqual(["cl:a", "cl:b/c"]);
    expect(m.nos[0]).toMatchObject({ membros: 2, w: 20, ciclo: true });
    expect(m.arestas).toEqual([[0, 1, "importa", 1, 5]]);
  });
  it("modo pasta usa o 1º nível; expandir mostra os membros", () => {
    expect(chaveGrupo(no("x", "b/c"), "pasta")).toBe("b");
    const e = agrupar(g, "modulo", alternarExpansao(new Set(), "a"));
    expect(e.nos.map((n) => n.id)).toEqual(["arq:a/x.ts", "arq:a/y.ts", "cl:b/c"]);
    expect(alternarExpansao(new Set(["a"]), "a").size).toBe(0);
  });
  it("acima de 5 000 nós o agrupamento é obrigatório", () => {
    expect(modoEfetivo("arquivo", LIMIAR_AGRUPAR + 1)).toBe("modulo");
    expect(modoEfetivo("arquivo", 10)).toBe("arquivo");
  });
});

describe("filtros", () => {
  it("monta o filtro do IPC e recusa pasta fora da raiz", () => {
    expect(pastaSegura("../etc")).toBe("");
    expect(pastaSegura("/src/a/")).toBe("src/a");
    expect(paraFiltroIpc({ ...FILTROS_VAZIOS, pasta: "src", soCiclos: true, minConfianca: "exata", linguagens: ["python"] })).toEqual({ linguagens: ["python"], pasta: "src", min_confianca: "exata", so_ciclos: true });
    expect(contarFiltros(FILTROS_VAZIOS)).toBe(0);
    expect(contarFiltros({ ...FILTROS_VAZIOS, pasta: "x", soCiclos: true })).toBe(2);
  });
  it("filtra localmente e reindexa as arestas", () => {
    const g = grafo([no("a", "m", { l: "typescript" }), no("b", "m", { t: "simbolo" }), no("c", "m", { l: "python", c: 2 })], [[0, 1, "chama", 1, 1], [0, 2, "importa", 0, 1], [2, 0, "importa", 1, 1]]);
    const so = filtrarLocal(g, { ...FILTROS_VAZIOS, tipos: ["arquivo"] });
    expect(so.nos.map((n) => n.id)).toEqual(["a", "c"]);
    expect(so.arestas).toEqual([[0, 1, "importa", 0, 1], [1, 0, "importa", 1, 1]]);
    expect(filtrarLocal(g, { ...FILTROS_VAZIOS, minConfianca: "exata" }).arestas).toHaveLength(2);
    expect(filtrarLocal(g, { ...FILTROS_VAZIOS, soCiclos: true }).nos.map((n) => n.id)).toEqual(["c"]);
  });
});
