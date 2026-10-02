import { describe, expect, it } from "vitest";
import { ESTAGIOS } from "../../compartilhado/bichinho";
import { calcularMaturidade, componentes, estagioDe, faltaParaProximo, LIMIARES, pontuacaoLog, ESCALA } from "./crescimento";

const calc = (tokens: number, k: number, max = 0) => calcularMaturidade({ tokens, conhecimentoItens: k, maximoGuardado: max });

describe("curva de maturidade (D-463)", () => {
  it("zero de tudo = ovo, maturidade 0", () => {
    const r = calc(0, 0);
    expect(r).toMatchObject({ maturidade: 0, estagio: "ovo", subiu: false });
    expect(r.componentes).toEqual({ tokens: 0, conhecimento: 0 });
  });

  it("escala logarítmica: 100 no teto de cada componente e nunca passa disso", () => {
    expect(pontuacaoLog(ESCALA.tokensCheio, ESCALA.tokensBase, ESCALA.tokensCheio)).toBeCloseTo(100, 6);
    expect(pontuacaoLog(ESCALA.tokensCheio * 50, ESCALA.tokensBase, ESCALA.tokensCheio)).toBe(100);
    expect(calc(1e12, 1e9).maturidade).toBe(100);
  });

  it("é monotônica em tokens e em conhecimento", () => {
    let anterior = -1;
    for (const t of [0, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9]) { const m = calc(t, 0).maturidade; expect(m).toBeGreaterThanOrEqual(anterior); anterior = m; }
    anterior = -1;
    for (const k of [0, 1, 10, 100, 1e3, 1e4, 1e5]) { const m = calc(0, k).maturidade; expect(m).toBeGreaterThanOrEqual(anterior); anterior = m; }
  });

  it("combina 60% tokens + 40% conhecimento", () => {
    const so = (t: number, k: number) => calc(t, k);
    expect(so(1e9, 0).maturidade).toBe(60);
    expect(so(0, 1e5).maturidade).toBe(40);
    expect(so(1e9, 1e5).maturidade).toBe(100);
    expect(so(1e9, 0).componentes).toEqual({ tokens: 100, conhecimento: 0 });
  });

  it("limiares dos estágios (borda inclusiva) e ordem ovo → lendário", () => {
    expect(LIMIARES.map(([e]) => e)).toEqual([...ESTAGIOS]);
    const casos: Array<[number, string]> = [[0, "ovo"], [2, "ovo"], [3, "filhote"], [19, "filhote"], [20, "jovem"], [44, "jovem"], [45, "adulto"], [69, "adulto"], [70, "veterano"], [89, "veterano"], [90, "lendario"], [100, "lendario"]];
    for (const [m, e] of casos) expect(estagioDe(m), String(m)).toBe(e);
  });

  it("NUNCA regride: o máximo guardado vale mesmo se o conhecimento encolher", () => {
    const antes = calc(1e8, 1e4);
    const depois = calcularMaturidade({ tokens: 1e8, conhecimentoItens: 0, maximoGuardado: antes.maturidade, estagioGuardado: antes.estagio });
    expect(depois.bruta).toBeLessThan(antes.maturidade);
    expect(depois.maturidade).toBe(antes.maturidade);
    expect(depois.estagio).toBe(antes.estagio);
    expect(depois.subiu).toBe(false);
  });

  it("sinaliza a subida de estágio uma única vez (a segunda leitura já parte do estágio novo)", () => {
    const primeira = calcularMaturidade({ tokens: 1e6, conhecimentoItens: 1e3, maximoGuardado: 10, estagioGuardado: "filhote" });
    expect(primeira.subiu).toBe(true);
    const segunda = calcularMaturidade({ tokens: 1e6, conhecimentoItens: 1e3, maximoGuardado: primeira.maturidade, estagioGuardado: primeira.estagio });
    expect(segunda.subiu).toBe(false);
  });

  it("entradas inválidas (NaN, negativo, Infinity) viram 0 sem quebrar", () => {
    expect(calc(Number.NaN, -5).maturidade).toBe(0);
    expect(componentes(-1, Number.NEGATIVE_INFINITY)).toEqual({ tokens: 0, conhecimento: 0 });
  });

  it("pontos de referência plausíveis: 1 M de tokens + 1 mil itens é jovem; 30 M + 2 mil é adulto", () => {
    expect(estagioDe(calc(1e6, 1e3).maturidade)).toBe("jovem");
    expect(estagioDe(calc(3e7, 2e3).maturidade)).toBe("adulto");
    expect(estagioDe(calc(2e4, 5).maturidade)).toBe("filhote");
  });

  it("quanto falta para o próximo estágio", () => {
    expect(faltaParaProximo(10)).toEqual({ proximo: "jovem", faltam: 10 });
    expect(faltaParaProximo(95)).toBeNull();
  });
});
