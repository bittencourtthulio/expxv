import { describe, expect, it } from "vitest";
import { CUSTO_DESCONHECIDO, explicarCusto, formatarBrl, formatarCusto, formatarTokens, formatarValorUsd } from "./custo-formato";

const c = (usd: number | null, incompleto = false, aproximado = false) => ({ usd, incompleto, aproximado });

describe("formatarCusto", () => {
  it("nunca transforma desconhecido em zero", () => {
    expect(formatarCusto(c(null))).toBe(CUSTO_DESCONHECIDO);
    expect(formatarCusto(null)).toBe(CUSTO_DESCONHECIDO);
    expect(formatarCusto(c(Number.NaN))).toBe(CUSTO_DESCONHECIDO);
    expect(formatarCusto(c(null, true, true))).not.toMatch(/0,00/);
  });
  it("marca incerteza: ≥ (incompleto), ≈ (aproximado) e ambos", () => {
    expect(formatarCusto(c(1.8))).toBe("US$ 1,80");
    expect(formatarCusto(c(1.8, true))).toBe("≥ US$ 1,80");
    expect(formatarCusto(c(0.42, false, true))).toBe("≈ US$ 0,42");
    expect(formatarCusto(c(1.8, true, true))).toBe("≥ ≈ US$ 1,80");
  });
  it("0 só aparece quando a soma medida é zero; valor minúsculo não vira 0,00", () => {
    expect(formatarCusto(c(0))).toBe("US$ 0,00");
    expect(formatarCusto(c(0.0042))).toBe("US$ 0,0042");
  });
  it("valor de registro e câmbio manual (sem câmbio, nada de R$)", () => {
    expect(formatarValorUsd(2, true)).toBe("≈ US$ 2,00");
    expect(formatarBrl(2, null)).toBeNull();
    expect(formatarBrl(null, 5)).toBeNull();
    expect(formatarBrl(2, 5)).toBe("≈ R$ 10,00");
  });
  it("tokens compactos e explicação", () => {
    expect(formatarTokens(950)).toBe("950");
    expect(formatarTokens(12_500)).toBe("12,5 mil");
    expect(formatarTokens(3_400_000)).toBe("3,4 mi");
    expect(explicarCusto({ ...c(null) })).toMatch(/desconhecido, não zero/);
    expect(explicarCusto({ ...c(1, true, true), fontes_ausentes: ["sem_fonte:gemini"] })).toMatch(/sem fonte de uso: sem_fonte:gemini/);
  });
});
