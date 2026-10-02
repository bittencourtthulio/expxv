import { describe, expect, it } from "vitest";
import type { Preco, Tokens } from "../../compartilhado/custo";
import { registroParaUsd, tokensZerados } from "./calcular";
import { casa, candidatosDoModelo, escolherPreco, especificidade, modelosSemPreco } from "./precos";
import { PRECOS_PADRAO, PRECOS_VALIDOS_DESDE } from "./precos-padrao";

const T = "2026-06-01T00:00:00.000Z";
const tk = (p: Partial<Tokens>): Tokens => ({ ...tokensZerados(), ...p });
let n = 0;
const preco = (p: Partial<Preco> & { padrao: string }): Preco => ({
  id: `p${++n}`, familia: null, entrada_por_mtok: 3, saida_por_mtok: 15, cache_escrita_por_mtok: null, cache_leitura_por_mtok: null, origem: "embutido", confirmado: false,
  valido_desde: PRECOS_VALIDOS_DESDE, fonte: null, coletado_em: null, ...p,
});
const embutida: Preco[] = PRECOS_PADRAO.map((p) => ({ ...p, id: `e_${p.padrao}`, origem: "embutido", confirmado: false, valido_desde: PRECOS_VALIDOS_DESDE, fonte: "x", coletado_em: T }));

describe("casamento de padrão", () => {
  it("glob e exato, sem diferenciar caixa; vendor/modelo também casa sem o vendor; sufixo :free é ignorado", () => {
    expect(casa("claude-sonnet-4*", "claude-sonnet-4-5-20250929")).toBe(true);
    expect(casa("claude-sonnet-4*", "Claude-Sonnet-4")).toBe(true);
    expect(casa("claude-sonnet-4*", "claude-sonnet-5")).toBe(false);
    expect(casa("gpt-5", "gpt-5-mini")).toBe(false);
    expect(casa("gpt-5", "openai/gpt-5")).toBe(true);
    expect(casa("meta/llama-3", "meta/llama-3:free")).toBe(true);
    expect(candidatosDoModelo("  ")).toEqual([]);
  });
  it("especificidade: exato vence glob; glob mais longo vence glob mais curto", () => {
    expect(especificidade("gpt-5")).toBeGreaterThan(especificidade("gpt-*"));
    expect(especificidade("claude-opus-4-5*")).toBeGreaterThan(especificidade("claude-*"));
  });
  it("metacaracteres de regex no padrão são literais", () => {
    expect(casa("gpt-4.1", "gpt-4x1")).toBe(false);
    expect(casa("a+b*", "a+bzz")).toBe(true);
  });
});

describe("escolherPreco", () => {
  it("padrão mais específico vence; modelo sem entrada = null; vazio = null", () => {
    const tabela = [preco({ padrao: "claude-*", entrada_por_mtok: 1 }), preco({ padrao: "claude-opus-4-5*", entrada_por_mtok: 5 })];
    expect(escolherPreco(tabela, "claude-opus-4-5-20251101", T)?.entrada_por_mtok).toBe(5);
    expect(escolherPreco(tabela, "claude-haiku", T)?.entrada_por_mtok).toBe(1);
    expect(escolherPreco(tabela, "gpt-5", T)).toBeNull();
    expect(escolherPreco(tabela, null, T)).toBeNull();
    expect(escolherPreco(tabela, "  ", T)).toBeNull();
  });
  it("override do usuário vence o embutido, mesmo com padrão menos específico; OpenRouter vence o embutido", () => {
    const tabela = [preco({ padrao: "claude-opus-4-5*", entrada_por_mtok: 5 }), preco({ padrao: "claude-*", entrada_por_mtok: 9, origem: "usuario", confirmado: true })];
    expect(escolherPreco(tabela, "claude-opus-4-5-x", T)?.entrada_por_mtok).toBe(9);
    const t2 = [preco({ padrao: "claude-sonnet-4*", entrada_por_mtok: 3 }), preco({ padrao: "anthropic/claude-sonnet-4.5", entrada_por_mtok: 3.3, origem: "openrouter", confirmado: true })];
    expect(escolherPreco(t2, "anthropic/claude-sonnet-4.5", T)?.origem).toBe("openrouter");
    expect(escolherPreco(t2, "claude-sonnet-4.5", T)?.origem).toBe("embutido");
  });
  it("valido_desde: só entra o que já valia no instante; a versão mais recente vence", () => {
    const tabela = [preco({ padrao: "m", entrada_por_mtok: 1, valido_desde: "2026-01-01T00:00:00.000Z" }), preco({ padrao: "m", entrada_por_mtok: 2, valido_desde: "2026-05-01T00:00:00.000Z" })];
    expect(escolherPreco(tabela, "m", "2025-12-31T00:00:00.000Z")).toBeNull();
    expect(escolherPreco(tabela, "m", "2026-03-01T00:00:00.000Z")?.entrada_por_mtok).toBe(1);
    expect(escolherPreco(tabela, "m", "2026-06-01T00:00:00.000Z")?.entrada_por_mtok).toBe(2);
  });
  it("modelosSemPreco lista os modelos fora da tabela, sem repetir nem null", () => {
    expect(modelosSemPreco(embutida, ["claude-sonnet-4-5", "modelo-novo", "modelo-novo", null, ""], T)).toEqual(["modelo-novo"]);
  });
});

describe("registroParaUsd", () => {
  const tabela = [
    preco({ padrao: "conf", familia: "anthropic", entrada_por_mtok: 3, saida_por_mtok: 15, cache_escrita_por_mtok: 3.75, cache_leitura_por_mtok: 0.3, confirmado: true }),
    preco({ padrao: "semcache", familia: "anthropic", entrada_por_mtok: 3, saida_por_mtok: 15, confirmado: true }),
    preco({ padrao: "naoconf", familia: "openai", entrada_por_mtok: 1.25, saida_por_mtok: 10, cache_leitura_por_mtok: 0.125 }),
    preco({ padrao: "generico", entrada_por_mtok: 2, saida_por_mtok: 8, origem: "openrouter", confirmado: true }),
  ];
  it("conta os quatro tipos de token e é exato quando o preço está confirmado e completo", () => {
    const r = registroParaUsd(tk({ entrada: 1_000_000, saida: 100_000, cache_escrita: 200_000, cache_leitura: 1_000_000 }), "conf", T, tabela);
    expect(r).toMatchObject({ origem: "tabela", aproximado: false });
    expect(r.usd).toBeCloseTo(3 + 1.5 + 0.75 + 0.3, 9);
  });
  it("modelo desconhecido ou ausente com tokens: usd null e origem desconhecido (nunca 0)", () => {
    expect(registroParaUsd(tk({ entrada: 10 }), "nao-existe", T, tabela)).toEqual({ usd: null, origem: "desconhecido", preco_id: null, aproximado: false });
    expect(registroParaUsd(tk({ saida: 1 }), null, T, tabela).usd).toBeNull();
  });
  it("0 só aparece quando os tokens são 0 (mesmo sem modelo)", () => {
    expect(registroParaUsd(tokensZerados(), null, T, tabela)).toMatchObject({ usd: 0, aproximado: false });
  });
  it("tarifa de cache derivada marca aproximado (anthropic 1,25x/0,10x)", () => {
    const r = registroParaUsd(tk({ cache_escrita: 1_000_000, cache_leitura: 1_000_000 }), "semcache", T, tabela);
    expect(r.aproximado).toBe(true);
    expect(r.usd).toBeCloseTo(3.75 + 0.3, 9);
  });
  it("sem tokens de cache a derivação não importa: não é aproximado se o preço é confirmado", () => {
    expect(registroParaUsd(tk({ entrada: 1_000_000 }), "semcache", T, tabela).aproximado).toBe(false);
  });
  it("preço não confirmado ⇒ aproximado mesmo completo", () => {
    expect(registroParaUsd(tk({ entrada: 1_000_000 }), "naoconf", T, tabela)).toMatchObject({ usd: 1.25, aproximado: true });
  });
  it("família desconhecida deriva o cache como a entrada (limite superior)", () => {
    const r = registroParaUsd(tk({ cache_leitura: 1_000_000 }), "generico", T, tabela);
    expect(r.usd).toBeCloseTo(2, 9);
    expect(r.aproximado).toBe(true);
  });
  it("valor medido pela fonte vence a tabela e nunca é aproximado", () => {
    expect(registroParaUsd(tk({ entrada: 5 }), "nao-existe", T, tabela, { usd: 0.42, origem: "cli" })).toEqual({ usd: 0.42, origem: "cli", preco_id: null, aproximado: false });
    expect(registroParaUsd(tk({ entrada: 5 }), "conf", T, tabela, { usd: 0, origem: "proxy" }).origem).toBe("proxy");
  });
  it("medido inválido (negativo, NaN) é ignorado e cai na tabela", () => {
    expect(registroParaUsd(tk({ entrada: 1_000_000 }), "conf", T, tabela, { usd: -1, origem: "cli" }).origem).toBe("tabela");
    expect(registroParaUsd(tk({ entrada: 1_000_000 }), "conf", T, tabela, { usd: Number.NaN, origem: "cli" }).origem).toBe("tabela");
  });
  it("tabela embutida: família com versão nova casa pelo glob; Opus novo (sem fonte) fica sem preço", () => {
    expect(registroParaUsd(tk({ entrada: 1_000_000 }), "claude-sonnet-4-5-20250929", T, embutida).usd).toBe(3);
    expect(registroParaUsd(tk({ entrada: 1_000_000 }), "claude-opus-4-5-20251101", T, embutida).usd).toBe(5);
    expect(registroParaUsd(tk({ entrada: 1_000_000 }), "claude-opus-9", T, embutida).usd).toBeNull();
    expect(registroParaUsd(tk({ entrada: 1_000_000 }), "gpt-5", T, embutida)).toMatchObject({ usd: 1.25, aproximado: true });
  });
  it("tabela embutida: toda entrada tem fonte e é não confirmada; nenhum valor é 0 ou negativo", () => {
    for (const p of PRECOS_PADRAO) {
      expect(p.entrada_por_mtok).toBeGreaterThan(0);
      expect(p.saida_por_mtok).toBeGreaterThan(0);
    }
    expect(new Set(PRECOS_PADRAO.map((p) => p.padrao)).size).toBe(PRECOS_PADRAO.length);
  });
});
