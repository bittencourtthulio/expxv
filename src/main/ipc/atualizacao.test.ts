import { describe, expect, it } from "vitest";
import { LIMITES_ATUALIZACAO } from "../../compartilhado/atualizacao";
import { validarAtualizacao, vConfigParcial } from "./atualizacao";

describe("validadores dos canais atualizacao:* (T-21.02)", () => {
  it("canais sem payload só aceitam undefined", () => {
    for (const c of ["atualizacao:estado", "atualizacao:config_obter", "atualizacao:verificar", "atualizacao:baixar", "atualizacao:cancelar"] as const) {
      expect(validarAtualizacao(c, undefined).ok, c).toBe(true);
      expect(validarAtualizacao(c, {}).ok, c).toBe(false);
      expect(validarAtualizacao(c, "x").ok, c).toBe(false);
    }
  });

  it("config_definir: parcial, estrito, sem campo desconhecido (nenhuma URL cabe)", () => {
    expect(vConfigParcial({ ligada: true })).toEqual({ ok: true, valor: { ligada: true } });
    expect(vConfigParcial({ canal: "beta", baixar_automatico: false, consentimento_versao: 1 }).ok).toBe(true);
    for (const ruim of [{}, [], null, "x", { canal: "alpha" }, { ligada: "sim" }, { feed: "https://x.test" }, { url: "https://x.test" }, { consentimento_versao: 1.5 }, { consentimento_versao: -1 }]) {
      expect(vConfigParcial(ruim).ok, JSON.stringify(ruim)).toBe(false);
    }
  });

  it("instalar exige confirmar_panes booleano e recusa campo extra", () => {
    expect(validarAtualizacao("atualizacao:instalar", { confirmar_panes: true }).ok).toBe(true);
    expect(validarAtualizacao("atualizacao:instalar", {}).ok).toBe(false);
    expect(validarAtualizacao("atualizacao:instalar", { confirmar_panes: 1 }).ok).toBe(false);
    expect(validarAtualizacao("atualizacao:instalar", { confirmar_panes: true, url: "x" }).ok).toBe(false);
  });

  it("reverter: só semver estrito (sem caminho nem URL)", () => {
    expect(validarAtualizacao("atualizacao:reverter", { versao: "1.2.3" }).ok).toBe(true);
    expect(validarAtualizacao("atualizacao:reverter", { versao: "1.2.3-beta.1" }).ok).toBe(true);
    for (const v of ["../1.2.3", "1.2", "https://x/1.2.3", "1.2.3; rm", "v1.2.3", "1.2.3-" + "a".repeat(40)]) expect(validarAtualizacao("atualizacao:reverter", { versao: v }).ok, v).toBe(false);
  });

  it("historico: limite 1..100", () => {
    expect(validarAtualizacao("atualizacao:historico", { limite: LIMITES_ATUALIZACAO.historico_max }).ok).toBe(true);
    expect(validarAtualizacao("atualizacao:historico", { limite: 101 }).ok).toBe(false);
    expect(validarAtualizacao("atualizacao:historico", { limite: 0 }).ok).toBe(false);
    expect(validarAtualizacao("atualizacao:historico", {}).ok).toBe(false);
  });
});
