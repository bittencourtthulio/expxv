import { describe, expect, it } from "vitest";
import { mud } from "./teste-fixtures";
import { agrupar } from "./linhas";

describe("agrupar mudanças", () => {
  const arq = [mud("a", "M", " "), mud("b", " ", "M"), mud("c", "M", "M"), mud("d", " ", " ", "naorastreado"), mud("e", "U", "U", "conflito")];
  it("git: conflitos, staged, não staged, não rastreados; arquivo com os dois lados aparece nos dois grupos", () => {
    const l = agrupar(arq, true);
    expect(l.filter((x) => x.k === "grupo").map((x) => (x.k === "grupo" ? `${x.id}:${x.n}` : ""))).toEqual(["conflitos:1", "staged:2", "naoStaged:2", "naoRastreados:1"]);
  });
  it("svn (sem stage): um grupo de alterados e os não rastreados", () => {
    const l = agrupar([mud("a", " ", "M"), mud("d", " ", " ", "naorastreado")], false);
    expect(l.filter((x) => x.k === "grupo").map((x) => (x.k === "grupo" ? x.id : ""))).toEqual(["naoStaged", "naoRastreados"]);
  });
  it("grupo recolhido não emite arquivos", () => {
    const l = agrupar(arq, true, new Set(["staged"] as const));
    expect(l.filter((x) => x.k === "arq" && x.grupo === "staged")).toHaveLength(0);
  });
});
