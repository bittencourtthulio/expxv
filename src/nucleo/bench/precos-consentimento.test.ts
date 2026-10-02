import { describe, expect, it } from "vitest";
import { assinaturaDe, criarCofreConsentimento } from "./consentimento";
import { calcularCusto, congelar, mediana, precoVigente, usdParaBrl, validarPreco } from "./precos";
import type { Estimativa, PrecoBench } from "./tipos";

const preco: PrecoBench = { provedor: "p", modelo: "m", preco_in_mtok: 3, preco_out_mtok: 15, preco_cache_mtok: 0.3, vale_desde: "2026-01-01T00:00:00.000Z" };
const uso = (o: Partial<Parameters<typeof calcularCusto>[0]> = {}) => ({ tokens_in: 1_000_000, tokens_out: 100_000, tokens_cache: 500_000, custo_relatado_usd: null, ...o });

describe("custo", () => {
  it("relatório da CLI vence a conta por tokens", () => {
    const c = calcularCusto(uso({ custo_relatado_usd: 0.5 }), congelar(preco));
    expect([c.custo_usd, c.custo_fonte, c.custo_tipo, c.preco]).toEqual([0.5, "relatorio_cli", "medido", null]);
    expect(calcularCusto(uso({ custo_relatado_usd: 0.5 }), null, { assinatura: true }).custo_tipo).toBe("equivalente_api");
  });
  it("sem relatório: tokens × preço (equivalente_api) com cache pelo preço de cache e preço congelado", () => {
    const c = calcularCusto(uso(), congelar(preco));
    expect(c.custo_usd).toBeCloseTo(3 + 1.5 + 0.15, 6);
    expect([c.custo_fonte, c.custo_tipo]).toEqual(["tabela_precos", "equivalente_api"]);
    expect(c.preco?.preco_in_mtok).toBe(3);
  });
  it("sem relatório e sem preço (ou sem tokens) → null/desconhecido, NUNCA zero", () => {
    for (const c of [calcularCusto(uso(), null), calcularCusto(uso({ tokens_in: null }), congelar(preco)), calcularCusto(uso({ tokens_out: null }), congelar(preco))]) {
      expect(c.custo_usd).toBeNull();
      expect(c.custo_fonte).toBe("desconhecido");
    }
    expect(calcularCusto(uso({ custo_relatado_usd: -1 }), null).custo_usd).toBeNull();
    expect(calcularCusto(uso({ custo_relatado_usd: Number.NaN }), null).custo_usd).toBeNull();
  });
  it("preço vigente respeita vale_desde e usa o mais recente; BRL só na exibição", () => {
    const t: PrecoBench[] = [preco, { ...preco, preco_in_mtok: 9, vale_desde: "2026-06-01T00:00:00.000Z" }];
    expect(precoVigente(t, "p", "m", "2026-03-01T00:00:00.000Z")?.preco_in_mtok).toBe(3);
    expect(precoVigente(t, "p", "m", "2026-07-01T00:00:00.000Z")?.preco_in_mtok).toBe(9);
    expect(precoVigente(t, "p", "m", "2025-01-01T00:00:00.000Z")).toBeNull();
    expect(usdParaBrl(2, 5.5)).toBe(11);
    expect(usdParaBrl(null, 5.5)).toBeNull();
    expect(usdParaBrl(1, 0)).toBeNull();
  });
  it("validarPreco recusa negativo, NaN e nomes estranhos", () => {
    expect(validarPreco(preco)).toBe(true);
    expect(validarPreco({ ...preco, preco_in_mtok: -1 })).toBe(false);
    expect(validarPreco({ ...preco, preco_out_mtok: Number.NaN })).toBe(false);
    expect(validarPreco({ ...preco, modelo: "x; rm" })).toBe(false);
    expect(validarPreco({ ...preco, vale_desde: "ontem" })).toBe(false);
  });
  it("mediana", () => { expect(mediana([])).toBeNull(); expect(mediana([3, 1, 2])).toBe(2); expect(mediana([1, 2, 3, 4])).toBe(2.5); });
});

describe("consentimento (puro, relógio injetado)", () => {
  const est = (frase: string | null = "RODAR"): Estimativa => ({ estimativa_id: "est_1", execucoes: 1, tarefas: ["t"], alvos: ["a"], custo_min_usd: null, custo_max_usd: null, alvos_sem_custo: 1, duracao_estimada_s: null, sandbox: "macos", frase_exigida: frase, teto_usd: null, avisos: [] });
  const guardar = (c: ReturnType<typeof criarCofreConsentimento>, e: Estimativa, sig = "sig") => c.guardarEstimativa({ estimativa: e, assinatura: sig, pesos: { q: 0.6, s: 0.2, c: 0.2 }, max_paralelo: 3, juiz_alvo: null, criada_em: 0 });
  it("a frase é exata; com frase nula nada é consentido", () => {
    const c = criarCofreConsentimento(() => 0);
    guardar(c, est());
    expect(c.consentir("est_1", "rodar")).toEqual({ erro: "confirmacao_invalida" });
    expect("token" in (c.consentir("est_1", "RODAR") as object)).toBe(true);
    const d = criarCofreConsentimento(() => 0);
    guardar(d, est(null));
    expect(d.consentir("est_1", "RODAR")).toEqual({ erro: "confirmacao_invalida" });
  });
  it("uso único, TTL 120 s, finalidade e assinatura conferidas", () => {
    let t = 0;
    const c = criarCofreConsentimento(() => t);
    guardar(c, est());
    const { token, expira_em } = c.consentir("est_1", "RODAR") as { token: string; expira_em: string };
    expect(new Date(expira_em).getTime()).toBe(120_000);
    expect(c.consumir(token, "est_1", "sig", "rodar")).not.toBeNull();
    expect(c.consumir(token, "est_1", "sig", "rodar")).toBeNull(); // reutilizado
    const t2 = (c.consentir("est_1", "RODAR") as { token: string }).token;
    t = 120_001;
    expect(c.consumir(t2, "est_1", "sig", "rodar")).toBeNull(); // expirado
    t = 0;
    const t3 = (c.consentir("est_1", "RODAR") as { token: string }).token;
    expect(c.consumir(t3, "est_1", "outra-assinatura", "rodar")).toBeNull(); // alvos/tarefas mudaram
    const t4 = (c.consentir("est_1", "RODAR", "julgar") as { token: string }).token;
    expect(c.consumir(t4, "est_1", "sig", "rodar")).toBeNull(); // finalidade errada
    const t5 = (c.consentir("est_1", "RODAR") as { token: string }).token;
    expect(c.consumir(t5, "est_2", "sig", "rodar")).toBeNull(); // outra estimativa
  });
  it("descartar (fechar o diálogo) invalida os tokens da estimativa", () => {
    const c = criarCofreConsentimento(() => 0);
    guardar(c, est());
    const { token } = c.consentir("est_1", "RODAR") as { token: string };
    c.descartar("est_1");
    expect(c.consumir(token, "est_1", "sig", "rodar")).toBeNull();
  });
  it("tokens são imprevisíveis (48 hex, sem repetição)", () => {
    const c = criarCofreConsentimento(() => 0);
    guardar(c, est());
    const ts = new Set(Array.from({ length: 50 }, () => (c.consentir("est_1", "RODAR") as { token: string }).token));
    expect(ts.size).toBe(50);
    expect([...ts].every((x) => /^[0-9a-f]{48}$/.test(x))).toBe(true);
  });
  it("assinaturaDe ignora a ordem de tarefas/alvos mas muda com pesos, teto e juiz", () => {
    const base = { tarefas: ["b", "a"], alvos: ["y", "x"], pesos: { q: 0.6, s: 0.2, c: 0.2 }, teto_usd: null, max_paralelo: 3, juiz_alvo: null };
    expect(assinaturaDe(base)).toBe(assinaturaDe({ ...base, tarefas: ["a", "b"], alvos: ["x", "y"] }));
    expect(assinaturaDe(base)).not.toBe(assinaturaDe({ ...base, teto_usd: 1 }));
    expect(assinaturaDe(base)).not.toBe(assinaturaDe({ ...base, juiz_alvo: "j" }));
    expect(assinaturaDe(base)).not.toBe(assinaturaDe({ ...base, pesos: { q: 1, s: 0, c: 0 } }));
  });
});
