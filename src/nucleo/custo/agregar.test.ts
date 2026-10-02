import { describe, expect, it } from "vitest";
import type { CustoResumo } from "../../compartilhado/custo";
import { amostrasCompletas, custoDaSprint, estimar, preverCustoMissao, preverPeriodo, resumir, resumirMissao, somarResumos, type LinhaAgregada } from "./agregar";
import { avaliarOrcamento, tetoEfetivo, alertaDeTeto } from "./orcamento";

const L = (p: Partial<LinhaAgregada> = {}): LinhaAgregada => ({ atribuicao: "card", modelo: "m", registros: 1, registros_sem_preco: 0, registros_aproximados: 0, tokens_entrada: 10, tokens_cache_escrita: 0, tokens_cache_leitura: 0, tokens_saida: 5, usd_conhecido: 1, ...p });

describe("resumir", () => {
  it("sem registros: usd null e registros 0 (nunca '0')", () => {
    expect(resumir([])).toMatchObject({ usd: null, registros: 0, incompleto: false, aproximado: false });
  });
  it("1 registro sem preço no meio de outros: incompleto, usd = soma do resto (CT-10.03)", () => {
    const r = resumir([L({ usd_conhecido: 2 }), L({ modelo: "", registros_sem_preco: 1, usd_conhecido: 0 })]);
    expect(r).toMatchObject({ usd: 2, incompleto: true, registros: 2, modelos: ["m"] });
  });
  it("todos sem preço: usd null e incompleto", () => {
    expect(resumir([L({ modelo: "", registros_sem_preco: 1, usd_conhecido: 0 })])).toMatchObject({ usd: null, incompleto: true });
  });
  it("aproximado quando algum registro tem preço não confirmado", () => {
    expect(resumir([L({ registros_aproximados: 1 })]).aproximado).toBe(true);
  });
  it("fonte ausente torna incompleto mesmo com tudo precificado, e nunca vira 0", () => {
    expect(resumir([], { fontes_ausentes: ["sem_fonte:gemini"] })).toMatchObject({ usd: null, incompleto: true, fontes_ausentes: ["sem_fonte:gemini"] });
    expect(resumir([L()], { fontes_ausentes: ["sem_fonte:gemini"] })).toMatchObject({ usd: 1, incompleto: true });
  });
  it("linha zerada por reatribuição não conta nem lista modelo", () => {
    const r = resumir([L({ registros: 0, tokens_entrada: 0, tokens_saida: 0, usd_conhecido: 0, modelo: "fantasma" })]);
    expect(r).toMatchObject({ usd: null, registros: 0, modelos: [] });
  });
});
describe("resumirMissao", () => {
  it("Σ cards + orquestração + sem card + ambíguo = total", () => {
    const m = resumirMissao([L({ atribuicao: "card", usd_conhecido: 1 }), L({ atribuicao: "orquestracao", usd_conhecido: 2 }), L({ atribuicao: "sem_card", usd_conhecido: 0.5 }), L({ atribuicao: "ambigua", usd_conhecido: 0.25 })]);
    expect(m.usd).toBeCloseTo(3.75, 9);
    expect((m.cards.usd ?? 0) + (m.orquestracao.usd ?? 0) + (m.sem_card.usd ?? 0) + (m.ambiguo.usd ?? 0)).toBeCloseTo(3.75, 9);
    expect(m.orquestracao.usd).toBe(2);
  });
  it("partes sem registro são usd null (não 0)", () => {
    expect(resumirMissao([L()]).ambiguo.usd).toBeNull();
  });
});
describe("somarResumos", () => {
  const r = (usd: number | null, incompleto = false): CustoResumo => ({ ...resumir([]), usd, incompleto, registros: usd === null ? 0 : 1 });
  it("null só se nenhuma parte tem preço; incompleto se alguma é", () => {
    expect(somarResumos([r(null), r(null)]).usd).toBeNull();
    expect(somarResumos([r(1), r(null, true)])).toMatchObject({ usd: 1, incompleto: true });
  });
});

describe("estimar (T-10.25)", () => {
  it("menos de 3 amostras: sem_historico e sem números", () => {
    expect(estimar([1, 2])).toEqual({ mediana_usd: null, p25_usd: null, p75_usd: null, amostras: 2, confianca: "sem_historico" });
  });
  it("mediana e quartis, confiança por nº de amostras", () => {
    expect(estimar([1, 2, 3, 4, 5])).toMatchObject({ mediana_usd: 3, p25_usd: 2, p75_usd: 4, amostras: 5, confianca: "baixa" });
    expect(estimar(Array.from({ length: 8 }, (_, i) => i)).confianca).toBe("media");
    expect(estimar(Array.from({ length: 20 }, (_, i) => i)).confianca).toBe("alta");
  });
  it("ignora NaN e negativos", () => {
    expect(estimar([1, 2, 3, Number.NaN, -4]).amostras).toBe(3);
  });
  it("amostrasCompletas exclui cards incompletos ou sem valor", () => {
    expect(amostrasCompletas([{ usd: 1, incompleto: false }, { usd: 2, incompleto: true }, { usd: null, incompleto: false }])).toEqual([1]);
  });
});

describe("previsões", () => {
  const atual = (usd: number | null): CustoResumo => ({ ...resumir([]), usd });
  it("histórico: restante = cards restantes × mediana", () => {
    const p = preverCustoMissao({ custo_atual: atual(2), cards_restantes: 3, cards_concluidos: 2, estimativa: estimar([1, 1, 1, 1]) });
    expect(p).toMatchObject({ base: "historico", restante_estimado_usd: 3, total_projetado_usd: 5 });
  });
  it("sem histórico mas com cards concluídos: ritmo; sem nada: sem_base e null", () => {
    expect(preverCustoMissao({ custo_atual: atual(4), cards_restantes: 2, cards_concluidos: 2, estimativa: estimar([]) })).toMatchObject({ base: "ritmo", restante_estimado_usd: 4, total_projetado_usd: 8, incompleto: true });
    expect(preverCustoMissao({ custo_atual: atual(null), cards_restantes: 2, cards_concluidos: 0, estimativa: estimar([]) })).toMatchObject({ base: "sem_base", restante_estimado_usd: null, total_projetado_usd: null });
  });
  it("nada restante: restante 0", () => {
    expect(preverCustoMissao({ custo_atual: atual(2), cards_restantes: 0, cards_concluidos: 5, estimativa: estimar([]) })).toMatchObject({ restante_estimado_usd: 0, total_projetado_usd: 2 });
  });
  it("período: ritmo dos últimos dias projetado até o fim", () => {
    const serie = [{ dia: "2026-06-01", usd: 10 }, { dia: "2026-06-02", usd: 10 }, { dia: "2026-06-03", usd: 10 }];
    const p = preverPeriodo({ serie, inicio: "2026-06-01", fim: "2026-06-10", hoje: "2026-06-03T12:00:00Z" });
    expect(p).toMatchObject({ gasto_usd: 30, dias_decorridos: 3, dias_restantes: 7, base: "ritmo", media_diaria_usd: 10, projecao_fim_periodo_usd: 100 });
  });
  it("período sem gasto: sem_base", () => {
    expect(preverPeriodo({ serie: [], inicio: "2026-06-01", fim: "2026-06-10", hoje: "2026-06-03" })).toMatchObject({ base: "sem_base", projecao_fim_periodo_usd: null, gasto_usd: null });
  });
});

describe("custoDaSprint", () => {
  const card = (usd: number, incompleto = false): CustoResumo => ({ ...resumir([L({ usd_conhecido: usd })]), incompleto });
  it("soma os cards e marca incompleto se um item não tem custo ou vínculo", () => {
    const custos: Record<string, CustoResumo> = { a: card(1), b: card(2) };
    const s = custoDaSprint("sp", [{ chave_card: "a" }, { chave_card: "b" }], (k) => custos[k] ?? null);
    expect(s).toMatchObject({ itens: 2, itens_sem_custo: 0, custo: { usd: 3, incompleto: false } });
    const s2 = custoDaSprint("sp", [{ chave_card: "a" }, { chave_card: null }, { chave_card: "z" }], (k) => custos[k] ?? null);
    expect(s2).toMatchObject({ itens_sem_custo: 2, custo: { usd: 1, incompleto: true } });
  });
});

describe("orçamento", () => {
  it("estados", () => {
    expect(avaliarOrcamento(1, null, 80).estado).toBe("sem_teto");
    expect(avaliarOrcamento(null, 10, 80).estado).toBe("sem_dado");
    expect(avaliarOrcamento(7, 10, 80).estado).toBe("ok");
    expect(avaliarOrcamento(8, 10, 80).estado).toBe("aviso");
    expect(avaliarOrcamento(8, 10, null).estado).toBe("ok");
    expect(avaliarOrcamento(10, 10, 80)).toMatchObject({ estado: "estourado", restante_usd: 0 });
    expect(avaliarOrcamento(1, 0, 80).estado).toBe("sem_teto");
  });
  it("teto efetivo: próprio ou padrão; alerta só em aviso/estourado", () => {
    expect(tetoEfetivo(null, { teto_padrao_missao_usd: 5 })).toBe(5);
    expect(tetoEfetivo(3, { teto_padrao_missao_usd: 5 })).toBe(3);
    expect(alertaDeTeto(avaliarOrcamento(1, 10, 80), "m", 1, 10)).toBeNull();
    expect(alertaDeTeto(avaliarOrcamento(12, 10, 80), "m", 12, 10)?.tipo).toBe("teto_missao");
    expect(alertaDeTeto(avaliarOrcamento(9, 10, 80), "m", 9, 10)?.tipo).toBe("aviso_teto_missao");
  });
});
