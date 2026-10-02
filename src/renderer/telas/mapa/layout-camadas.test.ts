import { describe, expect, it } from "vitest";
import type { FluxoMapaIpc, NoFluxoMapa } from "../../../compartilhado/mapa";
import { celulasDeViolacao, dsmParaTela, formaDoNo, layoutFluxo, ocultosPorColapso } from "./layout-camadas";

const n = (id: string, nivel: number, extra: Partial<NoFluxoMapa> = {}): NoFluxoMapa => ({ id, rotulo: id, tipo: "simbolo", nivel, tracejado: false, externo: false, em_ciclo: false, tabelas: [], caminho: null, linha: null, ...extra });
const fluxo: FluxoMapaIpc = {
  raiz: "ent:r", tabelas: ["usuarios"], externos: [], truncado: false,
  nos: [n("ent:r", 0, { tipo: "entrada" }), n("sim:a", 1), n("sim:b", 1, { tracejado: true }), n("sim:c", 2), n("tab:t", 2, { tipo: "tabela" })],
  arestas: [["ent:r", "sim:a", "aciona", 1, 0], ["ent:r", "sim:b", "aciona", 0, 0], ["sim:a", "sim:c", "chama", 1, 0], ["sim:c", "tab:t", "le_tabela", 1, 0], ["sim:c", "sim:a", "chama", 1, 1]],
};

describe("layout do fluxo", () => {
  it("camadas esquerda -> direita pelo nível; heurística tracejada; formas por tipo", () => {
    const l = layoutFluxo(fluxo);
    const x = (id: string) => l.nos.find((k) => k.id === id)?.x as number;
    expect(x("ent:r")).toBeLessThan(x("sim:a"));
    expect(x("sim:a")).toBeLessThan(x("sim:c"));
    expect(x("sim:a")).toBe(x("sim:b"));
    expect(l.arestas.find((a) => a.para === "sim:b")?.tracejado).toBe(true);
    expect(l.arestas.find((a) => a.para === "sim:a" && a.de === "ent:r")?.tracejado).toBe(false);
    expect(l.arestas.find((a) => a.retorno)).toBeTruthy();
    expect(formaDoNo(n("x", 0, { tipo: "entrada" }))).toBe("pilula");
    expect(formaDoNo(n("x", 0, { tipo: "tabela" }))).toBe("cilindro");
    expect(formaDoNo(n("x", 0, { tipo: "externo" }))).toBe("hexagono");
    expect(formaDoNo(n("x", 0))).toBe("retangulo");
  });
  it("colapsar um nó esconde o que só ele alcança", () => {
    expect([...ocultosPorColapso(fluxo, new Set(["sim:a"]))].sort()).toEqual(["sim:c", "tab:t"]);
    const l = layoutFluxo(fluxo, new Set(["sim:a"]));
    expect(l.nos.map((k) => k.id).sort()).toEqual(["ent:r", "sim:a", "sim:b"]);
    expect(l.nos.find((k) => k.id === "sim:a")?.colapsado).toBe(true);
    expect(l.ocultos).toBe(2);
  });
});

describe("DSM", () => {
  it("até 200 módulos fica como veio; acima agrega pela pasta de 1º nível", () => {
    const pequeno = { modulos: ["a", "b"], celulas: [[0, 1], [0, 0]], truncado: false };
    expect(dsmParaTela(pequeno).agregado).toBe(false);
    const mods = ["a/x", "a/y", "b/z"];
    const r = dsmParaTela({ modulos: mods, celulas: [[0, 1, 2], [0, 0, 3], [0, 0, 0]], truncado: false }, 2);
    expect(r).toEqual({ modulos: ["a", "b"], celulas: [[0, 5], [0, 0]], agregado: true });
    expect([...celulasDeViolacao([{ origem: "regra", de_modulo: "a/x", para_modulo: "b/z", evidencias: [], motivo: "" }], true)]).toEqual(["a>b"]);
  });
});
