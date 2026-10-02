import { describe, expect, it } from "vitest";
import { criarConsentimentos, validarUrlDeServico, type RegistroConsentimento } from "./consentimento";

function montar(versao = "v1") {
  let dados: RegistroConsentimento[] = [];
  const c = criarConsentimentos({ armazenamento: { ler: () => dados, gravar: async (r) => void (dados = [...r]) }, versao_texto: versao, agora: () => new Date("2026-10-01T10:00:00Z") });
  return { c, dados: () => dados, trocarVersao: (v: string) => criarConsentimentos({ armazenamento: { ler: () => dados, gravar: async (r) => void (dados = [...r]) }, versao_texto: v }) };
}

describe("consentimento por serviço e host", () => {
  it("nasce desligado, concede por host e revoga na hora", async () => {
    const { c } = montar();
    expect(c.vigente("voz_stt", "api.exemplo.com")).toBe(false);
    await c.conceder("voz_stt", "API.exemplo.com");
    expect(c.vigente("voz_stt", "api.exemplo.com")).toBe(true);
    expect(c.vigente("voz_stt", "outro.com")).toBe(false);
    expect(c.vigente("voz_refino", "api.exemplo.com")).toBe(false);
    await c.revogar("voz_stt", "api.exemplo.com");
    expect(c.vigente("voz_stt", "api.exemplo.com")).toBe(false);
  });

  it("nova versão do texto invalida o aceite antigo", async () => {
    const m = montar("v1");
    await m.c.conceder("voz_stt", "h.com");
    expect(m.trocarVersao("v2").vigente("voz_stt", "h.com")).toBe(false);
    expect(m.trocarVersao("v1").vigente("voz_stt", "h.com")).toBe(true);
  });

  it("validação de URL: https com nome de host; sem credencial, query, IP nem servidor local", () => {
    expect(validarUrlDeServico("https://api.exemplo.com/v1")).toMatchObject({ ok: true, host: "api.exemplo.com", hostname: "api.exemplo.com", porta: null, caminho: "/v1", loopback: false });
    expect(validarUrlDeServico("https://api.exemplo.com:8443/v1/")).toMatchObject({ ok: true, host: "api.exemplo.com:8443", porta: 8443, caminho: "/v1" });
    expect(validarUrlDeServico("http://api.exemplo.com").ok).toBe(false);
    expect(validarUrlDeServico("ftp://x.com").ok).toBe(false);
    expect(validarUrlDeServico("https://u:p@x.com").ok).toBe(false);
    expect(validarUrlDeServico("https://x.com/v1?key=abc").ok).toBe(false);
    expect(validarUrlDeServico("https://x.com/v1#frag").ok).toBe(false);
    expect(validarUrlDeServico("não é url").ok).toBe(false);
    // servidor local do usuário entra como motor de COMANDO local (a camada de rede recusa loopback e rede privada)
    for (const u of ["http://127.0.0.1:8080/v1", "https://127.0.0.1/v1", "http://localhost:9000", "https://localhost/v1"]) {
      const r = validarUrlDeServico(u);
      expect(r.ok, u).toBe(false);
      if (!r.ok) expect(r.motivo).toMatch(/comando local/);
    }
  });

  it("o loopback só vale para servidor falso de teste, e só com a opção explícita", () => {
    expect(validarUrlDeServico("http://127.0.0.1:8080/v1", { permitirLoopbackHttp: true })).toMatchObject({ ok: true, loopback: true, host: "127.0.0.1:8080", porta: 8080 });
    expect(validarUrlDeServico("http://exemplo.com/v1", { permitirLoopbackHttp: true }).ok).toBe(false);
  });
});
