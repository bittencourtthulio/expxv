// Servidor do relay em LOOPBACK (T-22.08): só 127.0.0.1, porta aleatória, relógio injetável, tudo fechado no `finally`.
import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import { request as pedidoHttp } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { VERSAO_PROTOCOLO_RELAY } from "../../compartilhado/relay";
import { abrirWs, type ConexaoWs } from "../remoto-estendido/ws-cliente";
import { assinarProva, serializar, type Papel } from "./protocolo";
import { criarLog } from "./log";
import { healthzPermitido, iniciarRelay, type OpcoesRelay, type ServidorRelay } from "./servidor";
import { canalAleatorio, parChave, relogioFalso, type ParChave } from "../../../tests/fixtures/relay/cenarios";

const abertos: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of abertos.splice(0).reverse()) await f();
});
async function subir(o: Partial<OpcoesRelay> = {}): Promise<ServidorRelay> {
  const s = await iniciarRelay({ bind: "127.0.0.1", porta: 0, log: criarLog({ agora: Date.now, saida: () => undefined }), ...o });
  abertos.push(() => s.fechar());
  return s;
}
interface Cli {
  ws: ConexaoWs;
  msgs: Array<string | Uint8Array>;
  fechado: () => number | null;
  esperar(pred: (m: string | Uint8Array) => boolean, ms?: number): Promise<string | Uint8Array>;
}
async function ligar(porta: number): Promise<Cli> {
  const msgs: Array<string | Uint8Array> = [];
  let codigo: number | null = null;
  const espera: Array<() => void> = [];
  const cli = { msgs, fechado: () => codigo } as unknown as Cli;
  const aberto = new Promise<void>((resolve, reject) => {
    const ws = abrirWs({
      url: `ws://127.0.0.1:${porta}/v1/canal/x`,
      aoAbrir: resolve,
      aoMensagem: (d) => (msgs.push(d), espera.splice(0).forEach((f) => f())),
      aoFechar: (c) => ((codigo = c), reject(new Error("fechou")), espera.splice(0).forEach((f) => f())),
    });
    cli.ws = ws;
  });
  cli.esperar = async (pred, ms = 3000) => {
    const fim = Date.now() + ms;
    for (;;) {
      const m = msgs.find(pred);
      if (m !== undefined) return m;
      if (Date.now() > fim || codigo !== null) throw new Error("sem mensagem");
      await new Promise<void>((r) => (espera.push(r), setTimeout(r, 50)));
    }
  };
  await aberto;
  abertos.push(() => cli.ws.fechar());
  return cli;
}
const jsonDe = (m: string | Uint8Array): Record<string, unknown> => JSON.parse(typeof m === "string" ? m : Buffer.from(m).toString()) as Record<string, unknown>;
async function autenticar(c: Cli, papel: Papel, canal: string, par: ParChave, extra: { cli?: Buffer; ef?: boolean } = {}): Promise<boolean> {
  const nonce = randomBytes(16);
  c.ws.enviar(serializar({ t: "hello", v: VERSAO_PROTOCOLO_RELAY, papel, canal, ts: Date.now(), nonce: nonce.toString("base64") }));
  const d = jsonDe(await c.esperar((m) => typeof m === "string" && jsonDe(m)["t"] === "desafio"));
  const sig = assinarProva(par.priv, { desafio: Buffer.from(d["n"] as string, "base64"), nonceCliente: nonce, canal, papel, cli: papel === "host" ? extra.cli : undefined, efemero: extra.ef });
  c.ws.enviar(JSON.stringify({ t: "prova", pub: par.pub.toString("base64"), sig: sig.toString("base64"), ...(papel === "host" && extra.cli !== undefined ? { cli: extra.cli.toString("base64") } : {}), ...(extra.ef === true ? { ef: 1 } : {}) }));
  const r = jsonDe(await c.esperar((m) => typeof m === "string" && ["ok", "erro"].includes(String(jsonDe(m)["t"]))));
  return r["t"] === "ok";
}
function http(porta: number, o: { metodo?: string; caminho: string; cab?: Record<string, string> }): Promise<{ status: number; corpo: string }> {
  return new Promise((resolve, reject) => {
    const r = pedidoHttp({ host: "127.0.0.1", port: porta, path: o.caminho, method: o.metodo ?? "GET", headers: o.cab ?? {}, agent: false }, (res) => {
      const p: Buffer[] = [];
      res.on("data", (c: Buffer) => p.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(p).toString() }));
    });
    r.on("error", reject);
    r.setTimeout(4000, () => r.destroy(new Error("timeout")));
    r.end();
  });
}

describe("servidor do relay em loopback", () => {
  it("host e cliente conversam pelo relay REAL: handshake com prova de posse e quadros binários opacos nos dois sentidos", async () => {
    const s = await subir();
    const canal = canalAleatorio();
    const host = parChave();
    const disp = parChave();
    const h = await ligar(s.porta);
    const c = await ligar(s.porta);
    expect(await autenticar(h, "host", canal, host, { cli: disp.pub })).toBe(true);
    expect(await autenticar(c, "cliente", canal, disp)).toBe(true);
    const q = new Uint8Array(randomBytes(300));
    expect(c.ws.enviar(q)).toBe(true);
    const recebido = await h.esperar((m) => typeof m !== "string");
    expect(Buffer.compare(Buffer.from(recebido as Uint8Array), Buffer.from(q))).toBe(0);
    h.ws.enviar(new Uint8Array([9, 9, 9]));
    expect([...((await c.esperar((m) => typeof m !== "string")) as Uint8Array)]).toEqual([9, 9, 9]);
    expect(s.metricas().quadros_repassados).toBe(2);
    // ping de controle
    c.ws.enviar(serializar({ t: "ping" }));
    expect(jsonDe(await c.esperar((m) => typeof m === "string" && jsonDe(m)["t"] === "pong"))).toEqual({ t: "pong" });
  });
  it("squatting e canal alheio: a prova ruim é recusada com a mesma resposta e a conexão cai", async () => {
    const s = await subir();
    const canal = canalAleatorio();
    const dono = parChave();
    const h = await ligar(s.porta);
    expect(await autenticar(h, "host", canal, dono)).toBe(true);
    const intruso = await ligar(s.porta);
    expect(await autenticar(intruso, "host", canal, parChave())).toBe(false);
    const inexistente = await ligar(s.porta);
    expect(await autenticar(inexistente, "cliente", canalAleatorio(), parChave())).toBe(false);
    expect(jsonDe(intruso.msgs.find((m) => typeof m === "string" && jsonDe(m)["t"] === "erro") as string)).toEqual(jsonDe(inexistente.msgs.find((m) => typeof m === "string" && jsonDe(m)["t"] === "erro") as string));
  });
  it("ax31_origem_nao_autentica: o upgrade com Origin de página alheia segue a mesma regra (a chave decide, a origem é ignorada)", async () => {
    const s = await subir();
    const r = await new Promise<{ codigo: number }>((resolve) => {
      const req = pedidoHttp({ host: "127.0.0.1", port: s.porta, path: "/v1/canal/x", headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": randomBytes(16).toString("base64"), Origin: "https://pagina-do-atacante.exemplo" }, agent: false });
      req.on("upgrade", (res, socket) => {
        socket.destroy();
        resolve({ codigo: res.statusCode ?? 0 });
      });
      req.on("response", (res) => resolve({ codigo: res.statusCode ?? 0 }));
      req.on("error", () => resolve({ codigo: 0 }));
      req.end();
    });
    expect(r.codigo).toBe(101); // aceita o upgrade: não há CORS nem lista de origens; a autenticação vem depois, pela chave
  });
  it("ax32_relay_nao_e_proxy (puro): `/healthz` só para GET, de interface interna, sem query e sem X-Forwarded-For", () => {
    const ok = { metodo: "GET", url: "/healthz", remoto: "127.0.0.1", xff: undefined };
    expect(healthzPermitido(ok)).toBe(true);
    expect(healthzPermitido({ ...ok, remoto: "::1" })).toBe(true);
    expect(healthzPermitido({ ...ok, remoto: "10.0.0.7" })).toBe(true);
    for (const x of [{ remoto: "203.0.113.9" }, { remoto: "8.8.8.8" }, { remoto: undefined }, { xff: "203.0.113.9" }, { metodo: "POST" }, { url: "/healthz?x=1" }, { url: "/healthz/" }, { url: "/" }]) expect(healthzPermitido({ ...ok, ...x }), JSON.stringify(x)).toBe(false);
  });
  it("ax32_relay_nao_e_proxy: só /healthz (interno) e o upgrade em /v1/canal/*; o resto é o MESMO 404; CONNECT e métodos estranhos não funcionam", async () => {
    const s = await subir();
    const base = await http(s.porta, { caminho: "/healthz" });
    expect(base).toEqual({ status: 200, corpo: '{"ok":true}' });
    // de "fora" (atrás do proxy: X-Forwarded-For presente) o /healthz some
    expect((await http(s.porta, { caminho: "/healthz", cab: { "X-Forwarded-For": "203.0.113.9" } })).status).toBe(404);
    const respostas = await Promise.all(
      ["/", "/v1/canal/x", "/v1/canal/", "/admin", "/metrics", "/healthz?x=1", "/../etc/passwd", "http://exemplo.com/", "/v1/pareamento/inicio"].map((p) => http(s.porta, { caminho: p })),
    );
    for (const r of respostas) expect(r).toEqual({ status: 404, corpo: '{"e":"nao_encontrado"}' });
    for (const m of ["POST", "PUT", "DELETE", "OPTIONS", "PATCH"]) expect((await http(s.porta, { caminho: "/healthz", metodo: m })).status).toBe(404);
    // CONNECT fecha o socket sem túnel
    const fechou = await new Promise<boolean>((resolve) => {
      const sk: Socket = connect(s.porta, "127.0.0.1", () => sk.write("CONNECT exemplo.com:443 HTTP/1.1\r\nHost: exemplo.com:443\r\n\r\n"));
      sk.on("data", () => resolve(false));
      sk.on("close", () => resolve(true));
      sk.on("error", () => resolve(true));
      setTimeout(() => resolve(false), 3000);
    });
    expect(fechou).toBe(true);
    // upgrade com caminho fora de /v1/canal/* ou sem os cabeçalhos certos é 404
    const bruto = (cab: string): Promise<string> =>
      new Promise((resolve) => {
        const sk = connect(s.porta, "127.0.0.1", () => sk.write(cab));
        let t = "";
        sk.on("data", (d: Buffer) => (t += d.toString()));
        sk.on("close", () => resolve(t));
        sk.on("error", () => resolve(t));
      });
    const k = randomBytes(16).toString("base64");
    expect(await bruto(`GET /outro HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${k}\r\n\r\n`)).toContain("404");
    expect(await bruto(`GET /v1/canal/x HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 8\r\nSec-WebSocket-Key: ${k}\r\n\r\n`)).toContain("404");
    expect(await bruto(`GET /v1/canal/x HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: curta\r\n\r\n`)).toContain("404");
  });
  it("ax18_flood_relay: conexões acima do teto por IP são recusadas; mensagem gigante pré-autenticação fecha; handshake lento é derrubado; o servidor segue de pé", async () => {
    const rel = relogioFalso();
    const s = await subir({ agora: () => rel.agora(), limites: { maxConexoesPorIp: 3 } });
    const clientes = await Promise.all([ligar(s.porta), ligar(s.porta), ligar(s.porta)]);
    // a 4ª conexão do mesmo IP recebe "limite" e é fechada
    const quarta = await ligar(s.porta).catch(() => null);
    if (quarta !== null) {
      expect(jsonDe(await quarta.esperar((m) => typeof m === "string"))).toEqual({ t: "erro", c: "limite" });
      expect(await quarta.esperar(() => false, 1500).catch(() => "fechou")).toBe("fechou");
    }
    // mensagem gigante antes de autenticar
    const g = clientes[0] as Cli;
    g.ws.enviar("x".repeat(5000));
    await new Promise((r) => setTimeout(r, 300));
    expect(g.fechado()).not.toBeNull();
    // handshake lento: o relógio avança 5 s e a varredura derruba quem não autenticou
    const lento = clientes[1] as Cli;
    rel.avancar(5_100);
    await new Promise((r) => setTimeout(r, 1500));
    expect(lento.fechado()).not.toBeNull();
    // o servidor segue aceitando
    const novo = await ligar(s.porta);
    expect(novo.ws.aberta).toBe(true);
    expect((await http(s.porta, { caminho: "/healthz" })).status).toBe(200);
  }, 15_000);
  it("ax23_log_sem_conteudo_nem_ip_cru: o log não tem payload, canal, chave nem IP em claro; o IP anônimo muda no dia seguinte", async () => {
    const linhas: string[] = [];
    const rel = relogioFalso();
    const log = criarLog({ agora: () => rel.agora(), saida: (l) => linhas.push(l) });
    const s = await subir({ log, agora: () => rel.agora() });
    const canal = canalAleatorio();
    const host = parChave();
    const disp = parChave();
    const h = await ligar(s.porta);
    const c = await ligar(s.porta);
    await autenticar(h, "host", canal, host, { cli: disp.pub });
    await autenticar(c, "cliente", canal, disp);
    const SENT = "SENTINELA-DO-LOG-" + randomBytes(5).toString("hex");
    c.ws.enviar(new Uint8Array(Buffer.from(SENT)));
    await h.esperar((m) => typeof m !== "string");
    const t = linhas.join("\n");
    expect(linhas.length).toBeGreaterThan(3);
    for (const proibido of ["127.0.0.1", "::1", "::ffff", canal, host.pub.toString("base64").slice(0, 20), disp.pub.toString("base64").slice(0, 20), SENT, Buffer.from(SENT).toString("base64")]) expect(t).not.toContain(proibido);
    for (const l of linhas) expect(JSON.parse(l)).toEqual(expect.objectContaining({ ev: expect.stringMatching(/^[a-z_]+$/) }));
    const hoje = log.anonimo("127.0.0.1");
    expect(log.anonimo("127.0.0.1")).toBe(hoje);
    rel.avancar(86_400_000 + 1000);
    expect(log.anonimo("127.0.0.1")).not.toBe(hoje); // sal diário: sem correlação entre dias
  });
  it("encerramento limpo: fechar() derruba tudo em < 2 s e deixa 0 conexões", async () => {
    const s = await iniciarRelay({ bind: "127.0.0.1", porta: 0, log: criarLog({ agora: Date.now, saida: () => undefined }) });
    const a = await ligar(s.porta);
    await ligar(s.porta);
    expect(s.conexoes()).toBe(2);
    const t = Date.now();
    await s.fechar();
    expect(Date.now() - t).toBeLessThan(2000);
    expect(s.conexoes()).toBe(0);
    for (let i = 0; i < 40 && a.fechado() === null; i++) await new Promise((r) => setTimeout(r, 50));
    expect(a.fechado()).not.toBeNull();
    expect(a.ws.aberta).toBe(false);
  });
  it("porta ocupada rejeita a promessa (não derruba o processo)", async () => {
    const s = await subir();
    await expect(iniciarRelay({ bind: "127.0.0.1", porta: s.porta, log: criarLog({ agora: Date.now, saida: () => undefined }) })).rejects.toBeDefined();
  });
});
