import { describe, expect, it } from "vitest";
import { calcularMaturidade, limitarMetaOvo, nivelVisualOvo, OVO, progressoOvo } from "./crescimento";

describe("regra do ovo (D-671): tarefas concluídas E piso de tokens", () => {
  it("constantes: meta 4 (configurável de 2 a 6) e piso de 150 mil tokens", () => {
    expect(OVO).toMatchObject({ metaTarefas: 4, metaMin: 2, metaMax: 6, pisoTokens: 150_000 });
  });

  // tarefas × tokens → progresso = min(tarefas/meta, tokens/piso), 0–100; só 100 quando AMBOS foram atingidos
  const TABELA: Array<[tarefas: number, tokens: number, progresso: number]> = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 500_000, 0],
    [1, 150_000, 25],
    [2, 80_000, 50], // 2/4 tarefas e 80 mil/150 mil tokens: manda o MENOR dos dois (50%), não o de tokens (53%)
    [3, 80_000, 53],
    [2, 1_000_000, 50],
    [3, 150_000, 75],
    [4, 75_000, 50],
    [4, 149_999, 99],
    [3, 5_000_000, 75],
    [4, 150_000, 100],
    [9, 9_000_000, 100],
  ];
  for (const [tarefas, tokens, esperado] of TABELA) {
    it(`${tarefas} tarefas e ${tokens} tokens → ${esperado}%`, () => {
      const o = progressoOvo({ tarefas, tokens });
      expect(o.progresso).toBe(esperado);
      expect(o.meta_tarefas).toBe(4);
      expect(o.piso_tokens).toBe(150_000);
    });
  }

  it("o primeiro trabalho (poucas tarefas, uns milhares de tokens) está longe de chocar", () => {
    expect(progressoOvo({ tarefas: 1, tokens: 30_000 }).progresso).toBeLessThan(25);
  });

  it("a meta é configurável de 2 a 6 e valores absurdos caem no limite ou no padrão", () => {
    expect(progressoOvo({ tarefas: 2, tokens: 150_000, meta: 2 }).progresso).toBe(100);
    expect(progressoOvo({ tarefas: 5, tokens: 150_000, meta: 6 }).progresso).toBe(83);
    expect([limitarMetaOvo(1), limitarMetaOvo(2), limitarMetaOvo(6), limitarMetaOvo(99), limitarMetaOvo("x"), limitarMetaOvo(Number.NaN), limitarMetaOvo(3.6)]).toEqual([2, 2, 6, 6, 4, 4, 4]);
  });

  it("entradas inválidas (negativo, NaN) nunca quebram nem passam de 0–100", () => {
    expect(progressoOvo({ tarefas: -3, tokens: Number.NaN }).progresso).toBe(0);
    expect(progressoOvo({ tarefas: Number.POSITIVE_INFINITY, tokens: 1e15 }).progresso).toBeLessThanOrEqual(100);
  });

  it("4 níveis visuais pelo progresso: 0–24, 25–49, 50–74, 75–99", () => {
    expect([0, 24, 25, 49, 50, 74, 75, 99, 100].map(nivelVisualOvo)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 3]);
  });
});

describe("estágio com o portão do ovo", () => {
  const base = { tokens: 5_000_000, conhecimentoItens: 200, maximoGuardado: 0 };

  it("sem chocar, a maturidade segue contando mas o estágio fica em ovo (mesmo com muita maturidade)", () => {
    const r = calcularMaturidade({ ...base, chocou: false });
    expect(r.maturidade).toBeGreaterThan(30);
    expect(r.estagio).toBe("ovo");
  });

  it("ao chocar, nasce com o estágio da curva existente (nunca menos que filhote) e avisa que subiu", () => {
    const r = calcularMaturidade({ ...base, chocou: true, estagioGuardado: "ovo" });
    expect(r.estagio).not.toBe("ovo");
    expect(r.subiu).toBe(true);
    expect(calcularMaturidade({ tokens: 150_000, conhecimentoItens: 0, maximoGuardado: 0, chocou: true }).estagio).toBe("filhote");
    expect(calcularMaturidade({ tokens: 0, conhecimentoItens: 0, maximoGuardado: 0, chocou: true }).estagio).toBe("filhote");
  });

  it("quem já passou do ovo (estágio guardado) NUNCA volta a ser ovo, mesmo se a regra disser chocou=false", () => {
    for (const e of ["filhote", "jovem", "adulto"] as const) {
      expect(calcularMaturidade({ tokens: 0, conhecimentoItens: 0, maximoGuardado: 25, estagioGuardado: e, chocou: false }).estagio).not.toBe("ovo");
    }
  });

  it("a curva a partir de filhote não mudou: mesmas maturidades e limiares de antes", () => {
    const antiga = calcularMaturidade(base);
    const nova = calcularMaturidade({ ...base, chocou: true, estagioGuardado: "filhote" });
    expect(nova.maturidade).toBe(antiga.maturidade);
    expect(nova.estagio).toBe(antiga.estagio);
  });
});
