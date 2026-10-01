import { describe, expect, it } from "vitest";
import { LIMITE_PAINEIS_PADRAO, limitePaineisDe, permissaoPadraoDe } from "./config-app";

const prefs = (mapa: Record<string, unknown>) => ({ obter: (c: string) => mapa[c] ?? null });

describe("limitePaineisDe", () => {
  it("usa o valor gravado quando é inteiro de 1 a 64", () => {
    expect(limitePaineisDe(prefs({ limite_paineis: 4 }))).toBe(4);
    expect(limitePaineisDe(prefs({ limite_paineis: 1 }))).toBe(1);
    expect(limitePaineisDe(prefs({ limite_paineis: 64 }))).toBe(64);
  });
  it("ausente, fora da faixa ou de outro tipo cai no padrão (16)", () => {
    expect(LIMITE_PAINEIS_PADRAO).toBe(16);
    for (const v of [undefined, 0, 65, 2.5, "8", null, NaN]) expect(limitePaineisDe(prefs({ limite_paineis: v }))).toBe(16);
  });
});

describe("permissaoPadraoDe", () => {
  it("'automatico' só se o valor gravado for exatamente esse", () => {
    expect(permissaoPadraoDe(prefs({ permissao_padrao: "automatico" }))).toBe("automatico");
    for (const v of [undefined, "seguro", "Automatico", "automatico ", true, 1, null]) expect(permissaoPadraoDe(prefs({ permissao_padrao: v }))).toBe("seguro");
  });
});
