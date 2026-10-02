// T-25.03: validadores ESTRITOS dos canais `laya:*` (05-CONTRATOS §29). O renderer só envia `modelo_id` (id do catálogo,
// formato fechado), `aceite_versao` do consentimento, host nominal do consentimento de rede e patches de config —
// NUNCA URL, caminho, checksum nem texto de pergunta (herdado A1 de AUDITORIA-VOZ-LOCAL).
import { describe, expect, it } from "vitest";
import { CANAIS_INVOKE_LAYA } from "../../compartilhado/laya";
import { VALIDADORES_LAYA, vHostLaya, vPatchConfigLaya } from "./laya";

describe("validadores laya:* (T-25.03)", () => {
  it("cada canal invoke do contrato tem validador, e nenhum validador é órfão", () => {
    expect(Object.keys(VALIDADORES_LAYA).sort()).toEqual([...CANAIS_INVOKE_LAYA].sort());
  });

  it("modelo_baixar: exige modelo_id, aceite_versao e ativar; extras recusados", () => {
    const v = VALIDADORES_LAYA["laya:modelo_baixar"];
    expect(v({ modelo_id: "laya-en", aceite_versao: "2026-10-02.1", ativar: true })).toEqual({
      ok: true,
      valor: { modelo_id: "laya-en", aceite_versao: "2026-10-02.1", ativar: true },
    });
    // SSRF por campo extra (herdado A1): url/caminho/checksum nunca são aceitos
    expect(v({ modelo_id: "laya-en", aceite_versao: "2026-10-02.1", ativar: true, url: "https://mal.example/x" }).ok).toBe(false);
    expect(v({ modelo_id: "laya-en", aceite_versao: "2026-10-02.1" }).ok).toBe(false);
    expect(v({ modelo_id: "../fora", aceite_versao: "2026-10-02.1", ativar: false }).ok).toBe(false);
    expect(v({ modelo_id: "laya-en", aceite_versao: "v;<script>", ativar: false }).ok).toBe(false);
  });

  it("pausar/retomar/cancelar/apagar/ativar: só modelo_id", () => {
    for (const canal of ["laya:modelo_pausar", "laya:modelo_retomar", "laya:modelo_cancelar", "laya:modelo_apagar", "laya:modelo_ativar"] as const) {
      expect(VALIDADORES_LAYA[canal]({ modelo_id: "laya-ml" }).ok).toBe(true);
      expect(VALIDADORES_LAYA[canal]({ modelo_id: "laya-ml", caminho: "/etc" }).ok).toBe(false);
      expect(VALIDADORES_LAYA[canal]({}).ok).toBe(false);
    }
  });

  it("estado/modelos_listar/testar: payload vazio; consentir: host nominal + booleano", () => {
    expect(VALIDADORES_LAYA["laya:estado"](undefined).ok).toBe(true);
    expect(VALIDADORES_LAYA["laya:modelos_listar"](undefined).ok).toBe(true);
    expect(VALIDADORES_LAYA["laya:testar"](undefined).ok).toBe(true);
    expect(VALIDADORES_LAYA["laya:estado"]({ qualquer: 1 }).ok).toBe(false);
    expect(VALIDADORES_LAYA["laya:consentir"]({ host: "huggingface.co", aceitar: true })).toEqual({ ok: true, valor: { host: "huggingface.co", aceitar: true } });
    expect(VALIDADORES_LAYA["laya:consentir"]({ host: "https://mal.example/x?a=1", aceitar: true }).ok).toBe(false);
    expect(VALIDADORES_LAYA["laya:consentir"]({ host: "mal example", aceitar: true }).ok).toBe(false);
    expect(vHostLaya("hf.co")).toBe(true);
    expect(vHostLaya("a.b-c.io")).toBe(true);
    expect(vHostLaya("http://a.b")).toBe(false);
    expect(vHostLaya("a.b/px")).toBe(false);
    expect(vHostLaya("user:senha@h")).toBe(false);
  });

  it("config_gravar: patch estrito com faixas (nunca aceita teto/timeout fora do contrato)", () => {
    expect(vPatchConfigLaya({ habilitado: true }).ok).toBe(true);
    expect(vPatchConfigLaya({}).ok).toBe(true);
    expect(vPatchConfigLaya({ habilitado: "sim" }).ok).toBe(false);
    expect(vPatchConfigLaya({ confianca_minima: 0.9 }).ok).toBe(true);
    expect(vPatchConfigLaya({ confianca_minima: 1.5 }).ok).toBe(false);
    expect(vPatchConfigLaya({ taxa_maxima_minuto: 0 }).ok).toBe(false);
    expect(vPatchConfigLaya({ taxa_maxima_minuto: 10_000 }).ok).toBe(false);
    expect(vPatchConfigLaya({ ociosidade_s: 10 }).ok).toBe(false);
    expect(vPatchConfigLaya({ timeout_ms: 5_000 }).ok).toBe(false); // campo do contrato interno, não da config
    expect(vPatchConfigLaya({ modelo_id: "laya-en" }).ok).toBe(true);
    expect(vPatchConfigLaya({ modelo_id: null }).ok).toBe(true);
  });
});
