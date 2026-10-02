// Integração REAL em loopback: relay de verdade (src/nucleo/relay/servidor) + `ws-cliente` com o WebSocket global do Node + ClienteRelay do host + serviço remoto da Fase 13 +
// celular falso com WebSocket real. Um TAP de TCP (o "operador do relay") grava TODOS os bytes e prova a cegueira com sentinelas em UTF-8, base64, hex e JSON escapada (AX-01).
import { randomBytes } from "node:crypto";
import { createServer, connect, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { criarCenarioRemoto } from "../../../tests/fixtures/jarvis/cenario-remoto";
import { ClienteViaRelay } from "../../../tests/fixtures/relay/cliente-pwa-falso";
import { criarLog } from "../relay/log";
import { iniciarRelay } from "../relay/servidor";
import { criarLeitor } from "../relay/ws-servidor";
import { carregarIdentidade } from "../remoto/identidade";
import { canalId, chaveEnvelope, epocaDe } from "./canal";
import { criarClienteRelay } from "./cliente-relay";
import { criarTransporteRelay } from "./transporte-relay";
import { abrirWs } from "./ws-cliente";

const limpeza: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of limpeza.splice(0).reverse()) await f();
});

/** TAP: proxy TCP transparente que grava os bytes nos dois sentidos. c2s vem mascarado pelo protocolo WebSocket; desmascarar é o que o operador do relay faria. */
async function tap(portaRelay: number): Promise<{ porta: number; s2c: Buffer[]; c2s: Buffer[]; payloadsC2s: Buffer[] }> {
  const s2c: Buffer[] = [];
  const c2s: Buffer[] = [];
  const payloadsC2s: Buffer[] = [];
  const socks = new Set<Socket>();
  const srv: Server = createServer((cli) => {
    const leitor = criarLeitor(() => 1 << 20);
    let handshakeVisto = false;
    const up = connect(portaRelay, "127.0.0.1");
    socks.add(cli);
    socks.add(up);
    cli.on("data", (d: Buffer) => {
      c2s.push(Buffer.from(d));
      if (!handshakeVisto) {
        const i = d.indexOf("\r\n\r\n");
        if (i >= 0) {
          handshakeVisto = true;
          const resto = d.subarray(i + 4);
          if (resto.length > 0) for (const e of leitor.alimentar(resto)) if ("dados" in e) payloadsC2s.push(e.dados);
        }
      } else for (const e of leitor.alimentar(d)) if ("dados" in e) payloadsC2s.push(e.dados);
      up.write(d);
    });
    up.on("data", (d: Buffer) => {
      s2c.push(Buffer.from(d));
      cli.write(d);
    });
    for (const x of [cli, up]) {
      x.on("error", () => undefined);
      x.on("close", () => (cli.destroy(), up.destroy()));
    }
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  limpeza.push(
    () =>
      new Promise<void>((r) => {
        for (const s of socks) s.destroy();
        srv.close(() => r());
      }),
  );
  return { porta: (srv.address() as { port: number }).port, s2c, c2s, payloadsC2s };
}
const codificacoes = (s: string): string[] => {
  const u = Buffer.from(s, "utf8");
  return [s, u.toString("base64"), u.toString("hex"), JSON.stringify(s).slice(1, -1), u.toString("base64url"), encodeURIComponent(s)];
};
const timerReal = (fn: () => void, ms: number): (() => void) => {
  const t = setTimeout(fn, ms);
  t.unref();
  return () => clearTimeout(t);
};
const espera = async (cond: () => boolean, ms = 4000): Promise<void> => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 10));
  if (!cond()) throw new Error("tempo esgotado");
};

describe("host + relay REAL + celular em loopback", () => {
  it("ax01_relay_nunca_ve_texto_claro (ponta a ponta): comando, título de Missão e saída de painel com sentinelas nunca aparecem em nenhum byte que o relay viu", async () => {
    const SENT_CMD = "SENTINELA-COMANDO-" + randomBytes(5).toString("hex");
    const SENT_MISSAO = "SENTINELA-MISSAO-ç-" + randomBytes(5).toString("hex");
    const SENT_PAINEL = "SENTINELA-PAINEL-é-" + randomBytes(5).toString("hex");
    const SENT_NOME = "SENTINELA-NOME-" + randomBytes(5).toString("hex");
    const cen = criarCenarioRemoto();
    await cen.ligar();
    limpeza.push(() => cen.fechar());
    cen.j.paineis.itens[0] = { ...(cen.j.paineis.itens[0] as object), pergunta_pendente: SENT_PAINEL, label: SENT_NOME } as never;
    const { cliente: pareado } = await cen.parear("leitura");
    const identidade = await carregarIdentidade({ ler: async (n) => cen.segredos.get(n) ?? null, gravar: async (n, v) => void cen.segredos.set(n, v) });
    // relay real + tap
    const logs: string[] = [];
    const relay = await iniciarRelay({ bind: "127.0.0.1", porta: 0, log: criarLog({ agora: Date.now, saida: (l) => logs.push(l) }) });
    limpeza.push(() => relay.fechar());
    const t = await tap(relay.porta);
    const url = `ws://127.0.0.1:${t.porta}/v1/canal/x`;
    // host
    const segredo = randomBytes(32);
    const chave = chaveEnvelope(segredo, "sessao");
    const real = cen.servico.tratador();
    const missoes = cen.j.servico;
    void missoes;
    const host = criarClienteRelay({ url, segredo, identidade, clientePub: pareado.par.publicaSpki, transporte: criarTransporteRelay({ tratador: real, chave }), relogio: { agora: Date.now }, agendar: timerReal, abrirWs });
    limpeza.push(() => host.fechar());
    host.iniciar();
    await espera(() => host.estado() === "registrado");
    // celular
    const celular = new ClienteViaRelay(abrirWs, { url, canal: canalId(segredo, epocaDe(Date.now())), chaveEnvelope: chave, chavePublicaDispositivo: pareado.par.publicaSpki, chavePrivadaDispositivo: pareado.par.privadaPkcs8, aguardar: async () => undefined });
    celular.par = pareado.par;
    celular.dispositivoId = pareado.dispositivoId;
    celular.identidadeFixada = pareado.identidadeFixada;
    limpeza.push(() => celular.fechar());
    expect(await celular.conectar()).toBe(true);
    expect((await celular.abrirSessao()).ok).toBe(true);
    const est = await celular.enviar({ t: "estado" });
    expect(JSON.stringify(est.msg)).toContain(SENT_PAINEL); // o celular VÊ o texto (decifrado por dentro)...
    const cmd = await celular.enviar({ t: "comando", texto: `status da missão ${SENT_MISSAO} — ${SENT_CMD}` });
    expect(cmd.status).toBe(200);
    expect(relay.metricas().quadros_repassados).toBeGreaterThanOrEqual(6);
    // ...e o relay, com tap no TCP, nunca viu nenhum dos sentinelas em nenhuma codificação
    const visto = [Buffer.concat(t.c2s), Buffer.concat(t.s2c), ...t.payloadsC2s].map((b) => b.toString("latin1")).join("\n") + logs.join("\n") + JSON.stringify(relay.metricas());
    expect(t.payloadsC2s.length).toBeGreaterThanOrEqual(6); // o tap realmente leu os quadros dos clientes
    for (const s of [SENT_CMD, SENT_MISSAO, SENT_PAINEL, SENT_NOME, "SENTINELA"]) for (const c of codificacoes(s)) expect(visto, c).not.toContain(Buffer.from(c, "utf8").toString("latin1"));
    for (const s of [SENT_CMD, SENT_MISSAO, SENT_PAINEL, SENT_NOME]) for (const c of codificacoes(s)) expect(Buffer.concat([...t.payloadsC2s, ...t.s2c]).includes(Buffer.from(c, "utf8")), c).toBe(false);
    // os quadros binários têm só tamanhos de bloco (+28 B): o relay não aprende o comprimento da fala
    const tamanhos = new Set(t.payloadsC2s.filter((b) => b.length > 100 && b[0] !== 0x7b).map((b) => b.length));
    for (const n of tamanhos) expect([256 + 28, 1024 + 28, 4096 + 28, 8192 + 28]).toContain(n);
  }, 20_000);

  it("relay real: revogar no desktop derruba o dispositivo no host mesmo com o relay intacto; fechar o host deixa 0 sockets no relay", async () => {
    const cen = criarCenarioRemoto();
    await cen.ligar();
    limpeza.push(() => cen.fechar());
    const { cliente: pareado } = await cen.parear("leitura");
    const identidade = await carregarIdentidade({ ler: async (n) => cen.segredos.get(n) ?? null, gravar: async (n, v) => void cen.segredos.set(n, v) });
    const relay = await iniciarRelay({ bind: "127.0.0.1", porta: 0, log: criarLog({ agora: Date.now, saida: () => undefined }) });
    limpeza.push(() => relay.fechar());
    const url = `ws://127.0.0.1:${relay.porta}/v1/canal/x`;
    const segredo = randomBytes(32);
    const chave = chaveEnvelope(segredo, "sessao");
    const host = criarClienteRelay({ url, segredo, identidade, clientePub: pareado.par.publicaSpki, transporte: criarTransporteRelay({ tratador: cen.servico.tratador(), chave }), relogio: { agora: Date.now }, agendar: timerReal, abrirWs });
    host.iniciar();
    await espera(() => host.estado() === "registrado");
    const celular = new ClienteViaRelay(abrirWs, { url, canal: canalId(segredo, epocaDe(Date.now())), chaveEnvelope: chave, chavePublicaDispositivo: pareado.par.publicaSpki, chavePrivadaDispositivo: pareado.par.privadaPkcs8, aguardar: async () => undefined });
    celular.par = pareado.par;
    celular.dispositivoId = pareado.dispositivoId;
    celular.identidadeFixada = pareado.identidadeFixada;
    limpeza.push(() => celular.fechar());
    expect(await celular.conectar()).toBe(true);
    await celular.abrirSessao();
    expect((await celular.enviar({ t: "ping" })).msg).toEqual({ t: "pong" });
    expect(await cen.servico.revogar(pareado.dispositivoId as string)).toBe(true);
    expect((await celular.enviar({ t: "ping" })).status).toBe(401); // o host recusa, sem depender do relay avisar
    host.fechar();
    await espera(() => relay.conexoes() <= 1); // só sobra o celular
    celular.fechar();
    await espera(() => relay.conexoes() === 0);
    expect(relay.metricas().canais).toBe(0);
  }, 20_000);
});
