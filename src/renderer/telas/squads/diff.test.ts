import { describe, expect, it } from "vitest";
import { diffDeLinhas } from "./diff";

describe("diffDeLinhas (lado a lado)", () => {
  it("textos iguais: tudo 'igual' nos dois lados", () => {
    const d = diffDeLinhas("a\nb", "a\nb");
    expect(d.esquerda.map((l) => l.tipo)).toEqual(["igual", "igual"]);
    expect(d.direita.map((l) => l.tipo)).toEqual(["igual", "igual"]);
    expect(d.diferentes).toBe(0);
  });

  it("linha alterada vira removida na esquerda e adicionada na direita, alinhadas com espaço", () => {
    const d = diffDeLinhas("a\nb\nc", "a\nB\nc");
    expect(d.esquerda.map((l) => l.tipo)).toEqual(["igual", "removida", "igual"]);
    expect(d.direita.map((l) => l.tipo)).toEqual(["igual", "adicionada", "igual"]);
    expect(d.esquerda[1]?.texto).toBe("b");
    expect(d.direita[1]?.texto).toBe("B");
    expect(d.diferentes).toBe(2);
    expect(d.esquerda).toHaveLength(d.direita.length);
  });

  it("linha só de um lado ganha 'vazia' no outro (alinhamento preservado)", () => {
    const d = diffDeLinhas("a\nc", "a\nb\nc");
    expect(d.esquerda.map((l) => l.tipo)).toEqual(["igual", "vazia", "igual"]);
    expect(d.direita.map((l) => l.tipo)).toEqual(["igual", "adicionada", "igual"]);
  });

  it("lado vazio (membro novo ou removido) marca o outro inteiro", () => {
    const novo = diffDeLinhas("", "x\ny");
    expect(novo.direita.map((l) => l.tipo)).toEqual(["adicionada", "adicionada"]);
    expect(novo.esquerda.every((l) => l.tipo === "vazia")).toBe(true);
  });

  it("texto enorme não trava: acima do limite cai para comparação simples, em tempo curto", () => {
    const a = Array.from({ length: 6000 }, (_, i) => `linha ${i}`).join("\n");
    const b = a.replace("linha 3000", "mudou");
    const t0 = performance.now();
    const d = diffDeLinhas(a, b);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(d.esquerda).toHaveLength(d.direita.length);
    expect(d.diferentes).toBeGreaterThan(0);
  });
});
