import { EventEmitter } from "node:events";
import { connect } from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { requisicaoCrua } from "../../../tests/fixtures/jarvis/cliente-remoto";
import { gerarCertificadoAutoassinado } from "./certificado";
import { relogioMovel } from "../../../tests/fixtures/jarvis/cenario-remoto";
import { criarManipulador, iniciarServidor, type RotasRemoto, type ServidorRemoto } from "./servidor";

const ok = { status: 200, corpo: { ok: true } };
const rotas = (extra: Partial<RotasRemoto> = {}): RotasRemoto => ({ pareamentoInicio: () => ok, pareamentoFim: () => ok, pareamentoStatus: () => ok, sessaoInicio: () => ok, canal: async () => ok, ...extra });
const abertos: ServidorRemoto[] = [];
afterEach(async () => {
  for (const s of abertos.splice(0)) await s.fechar();
});
async function subir(o: { rotas?: RotasRemoto; recusas?: string[]; hosts?: string[] } = {}) {
  const relogio = relogioMovel();
  let porta = 0;
  const recusas = o.recusas ?? [];
  const manipulador = criarManipulador({ relogio, transporte: "loopback", endereco: () => "127.0.0.1", porta: () => porta, hostsExtras: () => o.hosts ?? [], cgnat: () => false, rotas: o.rotas ?? rotas(), aoRecusar: (m) => recusas.push(m) });
  const s = await iniciarServidor({ transporte: "loopback", ip: "127.0.0.1", porta: 0, manipulador });
  porta = s.porta;
  abertos.push(s);
  return { s, relogio, recusas, req: (c: Partial<Parameters<typeof requisicaoCrua>[0]> & { caminho: string }) => requisicaoCrua({ ip: "127.0.0.1", porta: s.porta, corpo: "{}", ...c }) };
}

describe("servidor local (T-13.15)", () => {
  it("rota válida responde; qualquer rota/método/tipo desconhecido = o MESMO 404 (sem versão nem nome)", async () => {
    const { req } = await subir();
    expect((await req({ caminho: "/v1/canal" })).status).toBe(200);
    const respostas = await Promise.all([
      req({ caminho: "/" }),
      req({ caminho: "/v1/dispositivos" }),
      req({ caminho: "/v1/canal", metodo: "GET" }),
      req({ caminho: "/v1/canal", tipo: "text/plain" }),
      req({ caminho: "/v1/canal", tipo: null }),
      req({ caminho: "/v1/canal?x=1" }),
      req({ caminho: "/admin" }),
      req({ caminho: "/v1/canal", host: "evil.com" }),
      req({ caminho: "/v1/canal", origin: "https://evil.com" }),
    ]);
    expect(new Set(respostas.map((r) => `${r.status}|${r.corpo}`)).size).toBe(1);
    expect(respostas[0]?.status).toBe(404);
    expect(respostas[0]?.corpo).not.toMatch(/expxv|versao|version|dispositiv/i);
  });
  it("Host forjado e DNS rebinding recusados (AC-09)", async () => {
    const { req, recusas } = await subir();
    for (const host of ["evil.com", "127.0.0.1", "attacker.example:80", "0.0.0.0:1"]) expect((await req({ caminho: "/v1/canal", host })).status, host).toBe(404);
    expect(recusas.filter((m) => m === "host").length).toBe(4);
  });
  it("Origin estranho (CSRF a partir de página de terceiro) recusado; sem CORS", async () => {
    const { req } = await subir();
    const r = await req({ caminho: "/v1/canal", origin: "https://evil.com" });
    expect(r.status).toBe(404);
    const ok1 = await requisicaoCrua({ ip: "127.0.0.1", porta: abertos[0]!.porta, caminho: "/v1/canal", corpo: "{}" });
    expect(ok1.status).toBe(200);
  });
  it("corpo acima de 16 KiB é recusado e o app segue de pé", async () => {
    const { req } = await subir();
    const r = await req({ caminho: "/v1/canal", corpo: JSON.stringify({ x: "a".repeat(20_000) }) }).catch(() => ({ status: 413 }));
    expect([413, 0]).toContain(r.status);
    expect((await req({ caminho: "/v1/canal" })).status).toBe(200);
  });
  it("JSON inválido = 400 uniforme", async () => {
    const { req } = await subir();
    expect((await req({ caminho: "/v1/canal", corpo: "{ nao json" })).status).toBe(400);
  });
  it("flood nas rotas SEM autenticação: acima de 30 req/min por IP vira 429 antes da rota (AC-16)", async () => {
    let chamadas = 0;
    const { req } = await subir({ rotas: rotas({ sessaoInicio: () => (chamadas++, ok) }) });
    const rs = [];
    for (let i = 0; i < 45; i++) rs.push((await req({ caminho: "/v1/sessao/inicio" })).status);
    expect(rs.filter((s) => s === 200)).toHaveLength(30);
    expect(rs.filter((s) => s === 429).length).toBe(15);
    expect(chamadas).toBe(30);
  });
  it("o canal autenticado tem teto de rede mais folgado (240/min), sem estrangular o uso normal", async () => {
    const { req } = await subir();
    const rs = [];
    for (let i = 0; i < 250; i++) rs.push((await req({ caminho: "/v1/canal" })).status);
    expect(rs.filter((s) => s === 200)).toHaveLength(240);
    expect(rs.filter((s) => s === 429)).toHaveLength(10);
  });
  it("5 pareamentos recusados bloqueiam o IP por 10 min", async () => {
    const { req, relogio } = await subir({ rotas: rotas({ pareamentoFim: () => ({ status: 403, corpo: { e: "pareamento_expirado" } }) }) });
    for (let i = 0; i < 5; i++) expect((await req({ caminho: "/v1/pareamento/fim" })).status).toBe(403);
    expect((await req({ caminho: "/v1/canal" })).status).toBe(429);
    relogio.avancar(600_001);
    expect((await req({ caminho: "/v1/canal" })).status).toBe(200);
  });
  it("origem de rede fora da regra: o socket é fechado sem resposta (IP público)", () => {
    const manipulador = criarManipulador({ relogio: relogioMovel(), transporte: "lan", endereco: () => "192.168.1.20", porta: () => 1, hostsExtras: () => [], cgnat: () => false, rotas: rotas() });
    let destruido = false;
    const req = Object.assign(new EventEmitter(), { socket: { remoteAddress: "8.8.8.8", destroy: () => void (destruido = true) }, headers: { host: "192.168.1.20:1" }, url: "/v1/canal", method: "POST" });
    let respondeu = false;
    manipulador(req as never, { end: () => void (respondeu = true), setHeader: () => undefined, removeHeader: () => undefined } as never);
    expect(destruido).toBe(true);
    expect(respondeu).toBe(false);
  });
  it("bind: IP público, 0.0.0.0 e `lan` sem TLS são recusados antes de abrir socket; porta ocupada é tipada", async () => {
    const manipulador = () => undefined;
    await expect(iniciarServidor({ transporte: "lan", ip: "8.8.8.8", porta: 0, manipulador })).rejects.toMatchObject({ codigo: "bind_recusado" });
    await expect(iniciarServidor({ transporte: "loopback", ip: "0.0.0.0", porta: 0, manipulador })).rejects.toMatchObject({ codigo: "bind_recusado" });
    await expect(iniciarServidor({ transporte: "lan", ip: "192.168.1.20", porta: 0, manipulador })).rejects.toMatchObject({ codigo: "bind_recusado" });
    const { s } = await subir();
    await expect(iniciarServidor({ transporte: "loopback", ip: "127.0.0.1", porta: s.porta, manipulador })).rejects.toMatchObject({ codigo: "porta_ocupada" });
  });
  it("fechar derruba os sockets e a porta deixa de responder (0 sockets)", async () => {
    const { s, req } = await subir();
    expect((await req({ caminho: "/v1/canal" })).status).toBe(200);
    const porta = s.porta;
    await s.fechar();
    abertos.splice(0);
    await expect(requisicaoCrua({ ip: "127.0.0.1", porta, caminho: "/v1/canal", corpo: "{}" })).rejects.toBeTruthy();
    expect(s.conexoes()).toBe(0);
  });
  it("com TLS (certificado autoassinado): HTTPS responde e o cliente com `ca` confia", async () => {
    const cert = gerarCertificadoAutoassinado({ ips: ["127.0.0.1"] });
    let porta = 0;
    const manipulador = criarManipulador({ relogio: relogioMovel(), transporte: "loopback", endereco: () => "127.0.0.1", porta: () => porta, hostsExtras: () => [], cgnat: () => false, rotas: rotas() });
    const s = await iniciarServidor({ transporte: "loopback", ip: "127.0.0.1", porta: 0, tls: { key: cert.keyPem, cert: cert.certPem }, manipulador });
    abertos.push(s);
    porta = s.porta;
    const corpo = "{}";
    const txt = await new Promise<string>((resolve, reject) => {
      const c = connect({ host: "127.0.0.1", port: s.porta, ca: cert.certPem, servername: "" }, () => c.write(`POST /v1/canal HTTP/1.1\r\nHost: 127.0.0.1:${s.porta}\r\nContent-Type: application/json\r\nContent-Length: ${corpo.length}\r\nConnection: close\r\n\r\n${corpo}`));
      let t = "";
      c.on("data", (d) => (t += d.toString()));
      c.on("end", () => resolve(t));
      c.on("error", reject);
    });
    expect(txt).toMatch(/^HTTP\/1\.1 200/);
    expect(txt).toContain('"ok":true');
  });
});
