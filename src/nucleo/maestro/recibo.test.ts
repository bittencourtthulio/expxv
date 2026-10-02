import { describe, expect, it } from "vitest";
import type { FonteIntencao } from "../../compartilhado/maestro";
import { DECIDIDOR_REGRA, montarRecibo, reciboParaMarkdown, RECIBO_MAX, termoDoSinal, type EntradaRecibo } from "./recibo";

const base: EntradaRecibo = {
  id: "mrc_1", pipeline_id: "mpl_1", pipeline: "runx", intencao: "bug", confianca: 0.86, fonte: "regra", decididor: DECIDIDOR_REGRA, escolha_regra: "bug", escolha_decisor: null, divergiu: false, nivel: 3,
  sinais: ["bug.p.corrig", "bug.w.problema-em"], etapas: [{ etapa_id: "runx.e1", estado_inicial: "pendente" }, { etapa_id: "runx.e2", estado_inicial: "pendente" }, { etapa_id: "runx.e3", estado_inicial: "pendente" }, { etapa_id: "runx.e4", estado_inicial: "pendente" }],
};

describe("recibo do Maestro", () => {
  it("texto no formato do plano: intenção, confiança numérica, sinais, decisor desligado, nível e pipeline", () => {
    const r = montarRecibo(base);
    expect(r.texto).toBe("Maestro: bug (confiança 0,86) por regra [corrig, problema em]; decisor desligado. Nível Padrão. Pipeline runx: E1 → E2 → E3 → E4.");
    expect(r.texto.length).toBeLessThanOrEqual(RECIBO_MAX);
  });
  it.each<[FonteIntencao, RegExp]>([
    ["comando", /comando explícito do método/],
    ["explicito", /rótulo explícito/],
    ["regra", /por regra/],
    ["decisor", /por decisor openrouter \(anthropic\/claude-sonnet-4\)/],
    ["regra+decisor", /regra e decisor openrouter concordaram/],
    ["fallback", /regra \(decisor indisponível\).*decisor falhou/],
  ])("fonte %s", (fonte, re) => {
    const r = montarRecibo({ ...base, fonte, decididor: { tipo: "openrouter", modelo: "anthropic/claude-sonnet-4", endpoint_host: "openrouter.ai", latencia_ms: 100, custo_usd: null } });
    expect(r.texto).toMatch(re);
    expect(r.texto).toMatch(/confiança \d,\d\d/);
  });
  it("divergência fica visível; custo/latência null continuam null (nunca 0)", () => {
    const r = montarRecibo({ ...base, fonte: "regra", divergiu: true, escolha_decisor: "feature", decisor_ligado: true });
    expect(r.texto).toContain("O decisor sugeriu feature.");
    expect(r.divergiu).toBe(true);
    expect(r.decididor.custo_usd).toBeNull();
    expect(r.decididor.latencia_ms).toBeNull();
  });
  it("nunca contém o texto do usuário nem chave: só termos do léxico", () => {
    const r = montarRecibo({ ...base, sinais: ["bug.p.corrig"] });
    expect(JSON.stringify(r)).not.toMatch(/sk-|password|senha/i);
    expect(r.texto).not.toContain("pedido");
  });
  it("trunca em 240 e respeita pipelines longos", () => {
    const etapas = Array.from({ length: 30 }, (_, i) => ({ etapa_id: "runx.e1" as const, estado_inicial: "pendente" as const, i }));
    expect(montarRecibo({ ...base, etapas, sinais: Array.from({ length: 50 }, (_, i) => `bug.w.termo-${i}`) }).texto.length).toBeLessThanOrEqual(RECIBO_MAX);
  });
  it("etapas puladas pelo nível não aparecem na cadeia", () => {
    const r = montarRecibo({ ...base, etapas: [{ etapa_id: "runx.e1", estado_inicial: "pulada_nivel" }, { etapa_id: "runx.e2", estado_inicial: "pendente" }] });
    expect(r.texto).toContain("Pipeline runx: E2.");
    expect(r.texto).not.toContain("E1");
  });
  it("termoDoSinal e markdown do recibo", () => {
    expect(termoDoSinal("pedido.w.vale-a-pena")).toBe("vale a pena");
    expect(termoDoSinal("B7")).toBe("B7");
    const md = reciboParaMarkdown(montarRecibo(base), base.sinais);
    expect(md).toContain("- custo: desconhecido");
    expect(md).toContain("- sinais: corrig, problema em");
  });
});
