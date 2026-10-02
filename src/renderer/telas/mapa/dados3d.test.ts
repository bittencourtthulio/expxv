import { describe, expect, it } from "vitest";
import { agrupar } from "./agrupamento";
import { paraGrafo3D, categoriaDoNo } from "./dados3d";
import type { GrafoMapaIpc } from "../../../compartilhado/mapa";

const no = (id: string, g: string, extra: Record<string, unknown> = {}) => ({ id, r: id, t: "arquivo", g, w: 100, ...extra }) as unknown as GrafoMapaIpc["nos"][number];
const grafo = {
  nos: [no("a", "src/x", { l: "ts", k: 1, p: 0.9, c: 1 }), no("b", "src/x", { l: "ts", k: 0, p: 0.1, c: 1 }), no("c", "lib/y", { l: "go", p: 0.5 })],
  arestas: [[0, 1, "importa", 1, 3], [1, 2, "importa", 0, 2]],
} as unknown as GrafoMapaIpc;

describe("Mapa -> grafo 3D", () => {
  const ag = agrupar(grafo, "arquivo", new Set());
  it("mapeia linguagem, ciclo e legenda com contagem", () => {
    const d = paraGrafo3D(ag, "linguagem");
    expect(d.nos.map((n) => n.categoria)).toEqual(["ts", "ts", "go"]);
    expect(d.nos.filter((n) => n.alerta === true).map((n) => n.id)).toEqual(["a", "b"]);
    expect(d.legenda.find((l) => l.categoria === "ts")?.n).toBe(2);
    expect(d.legenda.find((l) => l.categoria === "ciclo")?.n).toBe(2);
    expect(d.elos[0]).toMatchObject({ a: "a", b: "b", alerta: true });
    expect(d.elos[1]?.peso).toBeCloseTo(0.8, 5);
  });
  it("camada, pacote e hotspot", () => {
    expect(paraGrafo3D(ag, "camada").nos.map((n) => n.categoria)).toEqual(["camada 1", "camada 0", "outros"]);
    expect(paraGrafo3D(ag, "pacote").nos.map((n) => n.categoria)).toEqual(["src", "src", "lib"]);
    expect(paraGrafo3D(ag, "hotspot").nos.map((n) => n.categoria)).toEqual(["quente", "frio", "morno"]);
  });
  it("cluster vira categoria de grupo e leva a contagem no rótulo", () => {
    const cl = agrupar(grafo, "modulo", new Set());
    const d = paraGrafo3D(cl, "linguagem");
    expect(d.nos.every((n) => n.categoria === "grupo")).toBe(true);
    expect(d.nos[0]?.rotulo).toMatch(/\(\d+\)$/);
    expect(categoriaDoNo(cl.nos[0] as never, "pacote", new Set())).toBe("grupo");
  });
});
