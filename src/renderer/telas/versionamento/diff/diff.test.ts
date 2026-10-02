import { describe, expect, it } from "vitest";
import { diffGrande, diffSimples, linhaDiff } from "../teste-fixtures";
import { achatar, paraLadoALado } from "./achatar";
import { familiaDe, tokenizarLinha } from "./tokenizar";

describe("achatar", () => {
  it("vira arquivo + hunk + linhas, com índice original da linha para o estágio", () => {
    const p = achatar(diffSimples());
    expect(p.map((l) => l.k)).toEqual(["arq", "hunk", "linha", "linha", "linha", "linha"]);
    expect(p.filter((l) => l.k === "linha").map((l) => (l.k === "linha" ? l.idx : -9))).toEqual([0, 1, 2, 3]);
  });
  it("binário e submódulo viram aviso, sem hunks", () => {
    const d = diffSimples();
    d.arquivos[0]!.binario = true;
    expect(achatar(d).map((l) => l.k)).toEqual(["arq", "aviso"]);
  });
  it("ignorar espaços: par -/+ que só difere em espaço vira contexto e desliga o estágio por linha", () => {
    const d = diffSimples();
    d.arquivos[0]!.hunks[0]!.linhas = [linhaDiff("del", "a  =  1", 1, null), linhaDiff("add", "a = 1", null, 1)];
    const p = achatar(d, { ignorarEspaco: true });
    const ls = p.filter((l) => l.k === "linha");
    expect(ls).toHaveLength(1);
    expect(ls[0]!.k === "linha" && ls[0]!.l.tipo).toBe("ctx");
  });
  it("arquivo acima do limite fica recolhido até pedir", () => {
    const d = diffGrande(0.01);
    const p = achatar(d, { limiteLinhasPorArquivo: 10 });
    expect(p.some((l) => l.k === "aviso" && l.texto.startsWith("Diff grande"))).toBe(true);
    expect(achatar(d, { limiteLinhasPorArquivo: 10, expandirGrandes: true }).length).toBeGreaterThan(100);
  });
  it("lado a lado pareia o bloco de remoções com o de adições", () => {
    const d = diffSimples();
    d.arquivos[0]!.hunks[0]!.linhas = [linhaDiff("del", "a", 1, null), linhaDiff("del", "b", 2, null), linhaDiff("add", "c", null, 1)];
    const pares = paraLadoALado(achatar(d)).filter((l) => l.k === "par");
    expect(pares).toHaveLength(2);
    expect(pares[0]!.k === "par" && pares[0]!.dir?.l.texto).toBe("c");
    expect(pares[1]!.k === "par" && pares[1]!.dir).toBeNull();
  });
  it("diff de ~2 MB achata sem travar (medido; orçamento folgado de 500 ms)", () => {
    const d = diffGrande(2);
    const t0 = performance.now();
    const p = achatar(d, { expandirGrandes: true });
    const ms = performance.now() - t0;
    // medição registrada: ver relatório da 6E (2 MB ≈ 35 mil linhas)
    expect(p.length).toBeGreaterThan(30_000);
    expect(ms).toBeLessThan(500);
  });
});

describe("tokenizar", () => {
  it("destaca palavra-chave, string, número e comentário", () => {
    const t = tokenizarLinha('const x = "a" + 42; // fim', familiaDe("a.ts"));
    expect(t.map((x) => x.t)).toEqual(expect.arrayContaining(["chave", "string", "numero", "comentario"]));
    expect(t.map((x) => x.s).join("")).toBe('const x = "a" + 42; // fim');
  });
  it("extensão desconhecida e linha gigante não são tokenizadas", () => {
    expect(tokenizarLinha("const x", familiaDe("a.txt"))).toEqual([{ t: "texto", s: "const x" }]);
    expect(tokenizarLinha("x".repeat(3000), "c")).toHaveLength(1);
  });
  it("comentário de hash em python", () => {
    expect(tokenizarLinha("x = 1  # nota", familiaDe("a.py")).at(-1)).toEqual({ t: "comentario", s: "# nota" });
  });
});
