import { describe, expect, it } from "vitest";
import { CONFIG_RELAY_PADRAO, LIMITES_RELAY, VERSAO_PROTOCOLO_RELAY, urlDoCanalRelay, validarConfigRelayParcial, validarUrlRelay } from "./relay";

describe("contratos do relay (Fase 22)", () => {
  it("ax34_nao_habilita_por_padrao: habilitado=false, experimental=true, sem URL e sem reconhecimento", () => {
    expect(CONFIG_RELAY_PADRAO.habilitado).toBe(false);
    expect(CONFIG_RELAY_PADRAO.experimental).toBe(true);
    expect(CONFIG_RELAY_PADRAO.url).toBe("");
    expect(CONFIG_RELAY_PADRAO.reconhecimento_experimental).toBe(false);
    expect(CONFIG_RELAY_PADRAO.consentimento_versao).toBe("");
    expect(Object.isFrozen(CONFIG_RELAY_PADRAO)).toBe(true);
    expect(VERSAO_PROTOCOLO_RELAY).toMatch(/^[a-z0-9]+-relay\.1$/);
    expect(LIMITES_RELAY.quadro_pre_auth).toBe(1024);
    expect(LIMITES_RELAY.quadro_max).toBe(64 * 1024);
  });
  it("url: só wss:// sem credencial, sem query/fragmento, sem IP privado, ≤ 200 caracteres", () => {
    expect(validarUrlRelay("wss://relay.exemplo.com.br")).toBe(true);
    expect(validarUrlRelay("wss://relay.exemplo.com.br:8443/v1")).toBe(true);
    for (const ruim of ["ws://relay.exemplo.com", "https://relay.exemplo.com", "wss://u:p@relay.exemplo.com", "wss://relay.exemplo.com?x=1", "wss://relay.exemplo.com#f", "wss://192.168.0.5", "wss://10.0.0.1", "wss://127.0.0.1", "wss://localhost", "wss://[::1]", "", "wss://" + "a".repeat(250) + ".com", "wss://relay.invalid", "wss://a b.com"]) expect(validarUrlRelay(ruim), ruim).toBe(false);
  });
  it("config parcial: campos fechados, tipos e tamanhos checados", () => {
    expect(validarConfigRelayParcial({ habilitado: true, url: "wss://r.exemplo.com" })).toEqual({ ok: true, valor: { habilitado: true, url: "wss://r.exemplo.com" } });
    expect(validarConfigRelayParcial({ padding: false })).toEqual({ ok: true, valor: { padding: false } });
    for (const ruim of [null, "x", { extra: 1 }, { habilitado: "sim" }, { url: "ws://x.com" }, { consentimento_versao: "x".repeat(40) }, { experimental: false }, { pwa_origem: "javascript:alert(1)" }]) {
      expect(validarConfigRelayParcial(ruim).ok, JSON.stringify(ruim)).toBe(false);
    }
  });
});

describe("achados da auditoria independente (A-06, A-07)", () => {
  it("ax22_so_wss_fora_do_teste (A-07): nome local com ponto final (`localhost.`, `api.local.`) é o mesmo nome local e é recusado; FQDN público com ponto final segue válido", () => {
    for (const ruim of ["wss://localhost./x", "wss://api.local./x", "wss://x.localhost./", "wss://relay.internal./", "wss://relay.invalid./", "wss://10.0.0.1./", "wss://localhost../"]) expect(validarUrlRelay(ruim), ruim).toBe(false);
    expect(validarUrlRelay("wss://relay.exemplo.com./v1/canal/x")).toBe(true);
  });
  it("A-06: a URL documentada (sem caminho) vira o caminho de canal; quem já traz caminho fica como está", () => {
    expect(urlDoCanalRelay("wss://relay.exemplo.com")).toBe("wss://relay.exemplo.com/v1/canal/x");
    expect(urlDoCanalRelay("wss://relay.exemplo.com/")).toBe("wss://relay.exemplo.com/v1/canal/x");
    expect(urlDoCanalRelay("wss://relay.exemplo.com:8443")).toBe("wss://relay.exemplo.com:8443/v1/canal/x");
    expect(urlDoCanalRelay("wss://relay.exemplo.com/v1/canal/abc")).toBe("wss://relay.exemplo.com/v1/canal/abc");
    expect(urlDoCanalRelay("ws://127.0.0.1:9000")).toBe("ws://127.0.0.1:9000/v1/canal/x");
  });
});

