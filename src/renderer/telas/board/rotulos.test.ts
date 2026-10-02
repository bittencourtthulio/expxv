import { describe, expect, it } from "vitest";
import type { CardBoard } from "../../../compartilhado/custo";
import { linhasDaColuna } from "./agrupar";
import { ariaCard, duracao } from "./rotulos";

const card = (id: string, extra: Partial<CardBoard> = {}): CardBoard => ({
  chave: `w|t|${id}`, task_id: id, trabalho_id: "t", trabalho_titulo: "Trabalho", workspace_id: "w", fase: "F1", titulo: id, coluna: "em_andamento", selos: ["pronta"], depende_de: [], suite: "nao_executada",
  mission_id: null, executor: null, handoff_status: null, duracao_observada_ms: null, custo: { usd: 1.8, incompleto: true, aproximado: false }, ...extra,
});

describe("rótulos do board", () => {
  it("aria do card anuncia id, coluna, selos e custo com marca de incerteza", () => {
    expect(ariaCard(card("T-03.04"))).toBe("T-03.04, em andamento, pronta, ≥ US$ 1,80");
    expect(ariaCard(card("T-1", { selos: [], custo: { usd: null, incompleto: false, aproximado: false } }))).toBe("T-1, em andamento, custo desconhecido");
  });
  it("duração", () => {
    expect(duracao(null)).toBe("—");
    expect(duracao(45_000)).toBe("45 s");
    expect(duracao(125 * 60_000)).toBe("2 h 5 min");
  });
  it("agrupamento em faixas recolhíveis", () => {
    const cs = [card("T-1"), card("T-2", { fase: "F2" }), card("T-3")];
    expect(linhasDaColuna(cs, "nenhum", new Set()).map((l) => l.tipo)).toEqual(["card", "card", "card"]);
    const l = linhasDaColuna(cs, "fase", new Set());
    expect(l.map((x) => x.tipo)).toEqual(["faixa", "card", "card", "faixa", "card"]);
    const r = linhasDaColuna(cs, "fase", new Set(["fase|F1"]));
    expect(r.map((x) => x.tipo)).toEqual(["faixa", "faixa", "card"]);
    expect(r[0]).toMatchObject({ recolhida: true, total: 2 });
  });
});
