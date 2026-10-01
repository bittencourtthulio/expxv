import { describe, expect, it } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import { VALIDADORES_LIMITES } from "./limites";

const C = "conta_01HZZZZZZZZZ";
const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-02T00:00:00.000Z";
const v = <K extends keyof typeof VALIDADORES_LIMITES>(canal: K, x: unknown) => VALIDADORES_LIMITES[canal](x);

describe("validadores limites:*", () => {
  it("cobrem exatamente os canais limites: do contrato", () => {
    expect(Object.keys(VALIDADORES_LIMITES).sort()).toEqual(CANAIS_INVOKE.filter((c) => c.startsWith("limites:")).sort());
  });

  it("snapshot/atualizar: opcionais; campo extra, id mal formado e lista grande são recusados", () => {
    expect(v("limites:snapshot", {}).ok).toBe(true);
    expect(v("limites:snapshot", { conta_ids: [C] }).ok).toBe(true);
    expect(v("limites:snapshot", { conta_ids: ["/etc/passwd"] }).ok).toBe(false);
    expect(v("limites:snapshot", { conta_ids: Array(51).fill(C) }).ok).toBe(false);
    expect(v("limites:snapshot", { extra: 1 }).ok).toBe(false);
    expect(v("limites:atualizar", { conta_id: "x" }).ok).toBe(false);
    expect(v("limites:atualizar", undefined).ok).toBe(false);
  });

  it("manual_definir: usado_pct fora de 0..100, NaN, janela desconhecida ou credit são recusados", () => {
    const base = { conta_id: C, janela: "five_hour", usado_pct: 50, reinicia_em: T1 };
    expect(v("limites:manual_definir", base).ok).toBe(true);
    expect(v("limites:manual_definir", { ...base, reinicia_em: null }).ok).toBe(true);
    for (const usado of [-1, 100.5, 101, Number.NaN, Infinity, "50", null]) expect(v("limites:manual_definir", { ...base, usado_pct: usado }).ok, String(usado)).toBe(false);
    expect(v("limites:manual_definir", { ...base, janela: "credit" }).ok).toBe(false);
    expect(v("limites:manual_definir", { ...base, janela: "hora" }).ok).toBe(false);
    expect(v("limites:manual_definir", { ...base, extra: 1 }).ok).toBe(false);
    expect(v("limites:manual_definir", { ...base, reinicia_em: "amanhã" }).ok).toBe(false);
  });

  it("manual_limpar: janela opcional", () => {
    expect(v("limites:manual_limpar", { conta_id: C }).ok).toBe(true);
    expect(v("limites:manual_limpar", { conta_id: C, janela: "weekly" }).ok).toBe(true);
    expect(v("limites:manual_limpar", { conta_id: C, janela: "credit" }).ok).toBe(false);
  });

  it("historico: max_pontos ≤ 300, desde < ate, balde só para modelo", () => {
    const base = { conta_id: C, janela: "weekly", desde: T0, ate: T1, max_pontos: 300 };
    expect(v("limites:historico", base).ok).toBe(true);
    expect(v("limites:historico", { ...base, max_pontos: 301 }).ok).toBe(false);
    expect(v("limites:historico", { ...base, max_pontos: 0 }).ok).toBe(false);
    expect(v("limites:historico", { ...base, desde: T1, ate: T0 }).ok).toBe(false);
    expect(v("limites:historico", { ...base, desde: T0, ate: T0 }).ok).toBe(false);
    expect(v("limites:historico", { ...base, janela: "modelo" }).ok).toBe(false);
    expect(v("limites:historico", { ...base, janela: "modelo", balde: "opus" }).ok).toBe(true);
    expect(v("limites:historico", { ...base, balde: "opus" }).ok).toBe(false);
    expect(v("limites:historico", { ...base, janela: "modelo", balde: "../x" }).ok).toBe(false);
    expect(v("limites:historico", { ...base, janela: "ano" }).ok).toBe(false);
  });

  it("previsao/eficiencia/alertas", () => {
    expect(v("limites:previsao", { conta_id: C }).ok).toBe(true);
    expect(v("limites:previsao", {}).ok).toBe(false);
    expect(v("limites:eficiencia", { semanas: 26 }).ok).toBe(true);
    expect(v("limites:eficiencia", { semanas: 27 }).ok).toBe(false);
    expect(v("limites:eficiencia", { semanas: 4, conta_id: C }).ok).toBe(true);
    expect(v("limites:alertas", {}).ok).toBe(true);
    expect(v("limites:alertas", { x: 1 }).ok).toBe(false);
  });
});
