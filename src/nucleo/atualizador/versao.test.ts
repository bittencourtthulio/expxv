import { describe, expect, it } from "vitest";
import { compararTextos, compararVersoes, lerVersao } from "./versao";
import { canalPermitido, caminhoDoManifesto, versaoCombinaComCanal } from "./canais";

describe("semver estrito (T-21.13)", () => {
  it.each([
    ["1.0.0", true],
    ["0.1.0", true],
    ["10.20.30", true],
    ["1.2.3-beta.1", true],
    ["1.2.3-beta", true],
    ["1.2.3-rc.1.2", true],
    ["1.2", false],
    ["v1.2.3", false],
    ["01.2.3", false],
    ["1.2.3+build", false],
    ["1.2.3-", false],
    ["1.2.3-beta.01", false],
    ["1.2.3-be ta", false],
    ["", false],
    ["1.2.3\n", false],
    ["9999999.0.0", false],
  ])("lerVersao(%j) → %s", (t, ok) => {
    expect(lerVersao(t) !== null).toBe(ok);
  });

  it("não aceita não-string nem texto gigante", () => {
    expect(lerVersao(1)).toBeNull();
    expect(lerVersao(null)).toBeNull();
    expect(lerVersao("1.0.0-" + "a".repeat(80))).toBeNull();
  });

  it.each([
    ["1.0.0", "1.0.1", -1],
    ["1.0.0", "1.1.0", -1],
    ["2.0.0", "1.9.9", 1],
    ["1.0.0", "1.0.0", 0],
    ["1.0.0-beta.1", "1.0.0", -1],
    ["1.0.0", "1.0.0-beta.9", 1],
    ["1.0.0-beta.2", "1.0.0-beta.10", -1],
    ["1.0.0-beta.1", "1.0.0-beta.1", 0],
    ["1.0.0-alpha", "1.0.0-beta", -1],
    ["1.0.0-beta", "1.0.0-beta.1", -1],
    ["1.0.0-1", "1.0.0-alpha", -1],
    ["1.2.0-beta.3", "1.1.9", 1],
  ])("compara %s com %s → %i", (a, b, esperado) => {
    expect(compararTextos(a, b)).toBe(esperado);
    expect(compararTextos(b, a)).toBe(-esperado || 0);
  });

  it("ordem total: transitiva e antissimétrica num conjunto", () => {
    const vs = ["0.9.0", "1.0.0-alpha", "1.0.0-beta.1", "1.0.0-beta.2", "1.0.0", "1.0.1", "1.1.0-beta.1", "1.1.0"].map((v) => lerVersao(v)!);
    for (const a of vs) for (const b of vs) for (const c of vs) if (compararVersoes(a, b) <= 0 && compararVersoes(b, c) <= 0) expect(compararVersoes(a, c)).toBeLessThanOrEqual(0);
    for (let i = 0; i < vs.length - 1; i++) expect(compararVersoes(vs[i]!, vs[i + 1]!)).toBe(-1);
  });
});

describe("canais (T-21.13)", () => {
  it("stable só com versão sem pré-release; beta aceita beta.N e a estável promovida", () => {
    expect(versaoCombinaComCanal("1.0.0", "stable")).toBe(true);
    expect(versaoCombinaComCanal("1.0.0-beta.1", "stable")).toBe(false);
    expect(versaoCombinaComCanal("1.0.0-beta.1", "beta")).toBe(true);
    expect(versaoCombinaComCanal("1.0.0", "beta")).toBe(true);
    expect(versaoCombinaComCanal("1.0.0-rc.1", "beta")).toBe(false);
    expect(versaoCombinaComCanal("x", "beta")).toBe(false);
  });
  it("beta exige consentimento; caminho do manifesto é por canal", () => {
    expect(canalPermitido("stable", false)).toBe(true);
    expect(canalPermitido("beta", false)).toBe(false);
    expect(canalPermitido("beta", true)).toBe(true);
    expect(caminhoDoManifesto("beta", "/")).toEqual({ manifesto: "/beta/manifesto.json", assinatura: "/beta/manifesto.json.sig" });
    expect(caminhoDoManifesto("stable", "/feed").manifesto).toBe("/feed/stable/manifesto.json");
  });
});
