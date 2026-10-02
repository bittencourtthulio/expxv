import { describe, expect, it } from "vitest";
import type { CustoResumo, LinhaRelatorio } from "../../compartilhado/custo";
import { intervalo, participacao, rotuloLinha, somaConfere, textoRelatorio } from "./uso-formato";

const r = (usd: number | null, extra: Partial<CustoResumo> = {}): CustoResumo => ({ usd, incompleto: false, aproximado: false, tokens: { entrada: 1000, cache_escrita: 0, cache_leitura: 200, saida: 500 }, registros: 1, modelos: [], fontes_ausentes: [], atualizado_em: null, ...extra });
const l = (chave: string, usd: number | null, rotulo = chave): LinhaRelatorio => ({ chave, rotulo, custo: r(usd) });

describe("uso: formato e conferência", () => {
  it("janela e participação (null quando sem preço, nunca 0)", () => {
    const i = intervalo("24h", new Date("2026-10-02T00:00:00.000Z"));
    expect(i.desde).toBe("2026-10-01T00:00:00.000Z");
    expect(participacao(r(1), r(4))).toBe(0.25);
    expect(participacao(r(null), r(4))).toBeNull();
    expect(participacao(r(1), r(null))).toBeNull();
  });
  it("Σ das linhas = total e rótulos honestos", () => {
    expect(somaConfere([l("a", 1), l("b", 2.5), l("c", null)], r(3.5))).toBe(true);
    expect(somaConfere([l("a", 1)], r(3))).toBe(false);
    expect(somaConfere([l("a", null)], r(null))).toBe(true);
    expect(rotuloLinha(l("", null, ""), "modelo")).toBe("modelo desconhecido");
  });
  it("texto copiável: sem conteúdo, com 'sem fonte de uso' como linha própria", () => {
    const t = textoRelatorio("modelo", "7d", [l("m1", 1.5)], r(1.5, { incompleto: true }), ["gemini"]);
    expect(t).toContain("equivalente em API");
    expect(t).toContain("sem fonte de uso\tgemini");
    expect(t).toContain("≥ US$ 1,50");
  });
});
