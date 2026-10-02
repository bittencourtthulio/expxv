import { describe, expect, it } from "vitest";
import { Acumulador, lerJsonc, normalizarRel, relativoA, resolverTodos } from "./comum";

describe("resolucao/comum", () => {
  it("normalizarRel: junta, colapsa e recusa escape da raiz", () => {
    expect(normalizarRel("a/b", "../c")).toBe("a/c");
    expect(normalizarRel("", "./x//y")).toBe("x/y");
    expect(normalizarRel("a", "../../x")).toBeNull();
    expect(normalizarRel("a", "..\\b")).toBe("b");
    expect(relativoA("a", "/etc/passwd")).toBeNull();
    expect(relativoA("a", "C:\\x")).toBeNull();
  });
  it("lerJsonc: comentários, vírgula final e // dentro de string", () => {
    expect(lerJsonc('{\n // c\n "a": "http://x", /* b */ "b": [1,],\n}')).toEqual({ a: "http://x", b: [1] });
    expect(lerJsonc("{ quebrado")).toBeNull();
  });
  it("Acumulador deduplica e a exata prevalece; autoimport é ignorado", () => {
    const ac = new Acumulador();
    const imp = { especificador: "./b", tipo: "estatico" as const, linha: 4, so_tipo: false, nomes: [] };
    ac.ligar("a.ts", imp, "arq:b.ts", "heuristica");
    ac.ligar("a.ts", { ...imp, linha: 2 }, "arq:b.ts", "exata");
    ac.ligar("a.ts", imp, "arq:a.ts", "exata");
    const r = ac.resultado();
    expect(r.arestas).toEqual([{ de: "arq:a.ts", para: "arq:b.ts", tipo: "importa", confianca: "exata", linha: 2, peso: 2 }]);
    expect(r.ligacoes).toHaveLength(3);
  });
  it("resolverTodos soma pesos", () => {
    const ac = new Acumulador();
    ac.ligar("a", { especificador: "x", tipo: "estatico", linha: 1, so_tipo: false, nomes: [] }, "arq:b", "exata");
    const r = { linguagens: [], resolver: () => ac.resultado() };
    expect(resolverTodos([r, r], { arquivos: new Map(), manifestos: [] }).arestas[0]?.peso).toBe(2);
  });
});
