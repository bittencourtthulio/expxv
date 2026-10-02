import { describe, expect, it } from "vitest";
import { criarBloqueioIp, criarLimiteJanela, hostPermitido, ipDeBindPermitido, ipPrivado, normalizarIp, origemDoNavegadorPermitida, origemPermitida } from "./politica-rede";

const relogio = () => {
  let t = 0;
  return { agora: () => t, avancar: (ms: number) => void (t += ms) };
};

describe("IP privado e bind", () => {
  it.each(["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.1", "192.168.0.10", "::ffff:192.168.1.5", "fd12:3456::1", "fe80::1%en0"])("%s é privado", (ip) => expect(ipPrivado(ip)).toBe(true));
  it.each(["8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.0.1", "1.1.1.1", "100.64.0.1", "169.254.1.1", "2001:db8::1", "nao-ip", "", "0.0.0.0", "127.0.0.1"])("%s NÃO é privado", (ip) => expect(ipPrivado(ip)).toBe(false));
  it("CGNAT (Tailscale) só com opt-in", () => {
    expect(ipPrivado("100.64.1.1", { cgnat: true })).toBe(true);
    expect(ipPrivado("100.128.1.1", { cgnat: true })).toBe(false);
  });
  it("nunca faz bind em 0.0.0.0/::; loopback só no modo túnel/teste", () => {
    expect(ipDeBindPermitido("0.0.0.0", "lan")).toBe(false);
    expect(ipDeBindPermitido("::", "lan")).toBe(false);
    expect(ipDeBindPermitido("0.0.0.0", "loopback")).toBe(false);
    expect(ipDeBindPermitido("8.8.8.8", "lan")).toBe(false);
    expect(ipDeBindPermitido("192.168.1.2", "lan")).toBe(true);
    expect(ipDeBindPermitido("127.0.0.1", "lan")).toBe(false);
    expect(ipDeBindPermitido("127.0.0.1", "loopback")).toBe(true);
    expect(ipDeBindPermitido("192.168.1.2", "loopback")).toBe(false);
  });
  it("origem do par: IP público recusado em qualquer modo", () => {
    expect(origemPermitida("8.8.8.8", "lan")).toBe(false);
    expect(origemPermitida("8.8.8.8", "loopback")).toBe(false);
    expect(origemPermitida("::ffff:10.0.0.5", "lan")).toBe(true);
    expect(origemPermitida("127.0.0.1", "lan")).toBe(false);
    expect(origemPermitida(undefined, "lan")).toBe(false);
    expect(normalizarIp("::FFFF:10.0.0.5")).toBe("10.0.0.5");
  });
});

describe("Host e Origin (DNS rebinding / CSRF)", () => {
  const o = { endereco: "192.168.1.20", porta: 51234, transporte: "lan" as const };
  it("Host precisa ser exatamente IP:porta", () => {
    expect(hostPermitido("192.168.1.20:51234", o)).toBe(true);
    for (const h of [undefined, "", "evil.com", "evil.com:51234", "192.168.1.20", "192.168.1.20:80", "localhost:51234", "192.168.1.20:51234.evil.com", "0.0.0.0:51234", "192.168.1.20:51234, evil.com"]) expect(hostPermitido(h, o), String(h)).toBe(false);
  });
  it("hosts extras só os configurados pelo usuário; localhost só no modo loopback", () => {
    expect(hostPermitido("meu-mac.ts.net:51234", { ...o, extras: ["meu-mac.ts.net"] })).toBe(true);
    expect(hostPermitido("outro.ts.net:51234", { ...o, extras: ["meu-mac.ts.net"] })).toBe(false);
    expect(hostPermitido("localhost:9", { endereco: "127.0.0.1", porta: 9, transporte: "loopback" })).toBe(true);
  });
  it("Origin: ausente passa (cliente nativo); presente só se for a própria origem", () => {
    expect(origemDoNavegadorPermitida(undefined, o)).toBe(true);
    expect(origemDoNavegadorPermitida("https://192.168.1.20:51234", o)).toBe(true);
    for (const x of ["https://evil.com", "null", "https://192.168.1.20:51234.evil.com", "https://192.168.1.20:80", "file://", "javascript:1", "https://u:p@192.168.1.20:51234", "https://192.168.1.20:51234/x", ""]) expect(origemDoNavegadorPermitida(x, o), x).toBe(false);
  });
});

describe("limites", () => {
  it("janela de 1 minuto por chave", () => {
    const r = relogio();
    const l = criarLimiteJanela(r, 3);
    expect([1, 2, 3, 4].map(() => l.tentar("ip"))).toEqual([true, true, true, false]);
    expect(l.tentar("outro")).toBe(true);
    r.avancar(60_001);
    expect(l.tentar("ip")).toBe(true);
  });
  it("5 pareamentos falhos bloqueiam o IP por 10 min", () => {
    const r = relogio();
    const b = criarBloqueioIp(r);
    for (let i = 0; i < 4; i++) b.registrarFalha("10.0.0.5");
    expect(b.bloqueado("10.0.0.5")).toBe(false);
    b.registrarFalha("10.0.0.5");
    expect(b.bloqueado("10.0.0.5")).toBe(true);
    expect(b.bloqueado("::ffff:10.0.0.5")).toBe(true);
    expect(b.bloqueado("10.0.0.6")).toBe(false);
    r.avancar(600_001);
    expect(b.bloqueado("10.0.0.5")).toBe(false);
  });
});
