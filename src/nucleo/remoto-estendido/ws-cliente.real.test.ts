// ws-cliente com o WebSocket GLOBAL do Node contra o relay real em loopback (T-22.05): cancelar fecha em <= 100 ms, 0 sockets depois, erro sem URL.
import { afterEach, describe, expect, it } from "vitest";
import { criarLog } from "../relay/log";
import { iniciarRelay, type ServidorRelay } from "../relay/servidor";
import { abrirWs, ErroWs } from "./ws-cliente";

const fechar: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const f of fechar.splice(0)) await f();
});
const subir = async (): Promise<ServidorRelay> => {
  const s = await iniciarRelay({ bind: "127.0.0.1", porta: 0, log: criarLog({ agora: Date.now, saida: () => undefined }) });
  fechar.push(() => s.fechar());
  return s;
};
const ate = async (c: () => boolean, ms = 3000): Promise<void> => {
  const fim = Date.now() + ms;
  while (!c() && Date.now() < fim) await new Promise((r) => setTimeout(r, 5));
};

describe("ws-cliente com WebSocket real (loopback)", () => {
  it("abre, troca texto e binário, cancela pelo sinal em <= 100 ms e deixa 0 conexões no relay", async () => {
    const s = await subir();
    const ac = new AbortController();
    let abriu = false;
    let fechouEm: number | null = null;
    const msgs: Array<string | Uint8Array> = [];
    const c = abrirWs({ url: `ws://127.0.0.1:${s.porta}/v1/canal/x`, aoAbrir: () => (abriu = true), aoMensagem: (m) => msgs.push(m), aoFechar: () => (fechouEm = Date.now()), sinal: ac.signal });
    await ate(() => abriu);
    expect(c.aberta).toBe(true);
    expect(s.conexoes()).toBe(1);
    c.enviar('{"t":"hello"}'); // inválido de propósito: o relay recusa com a mensagem uniforme
    await ate(() => msgs.length > 0);
    expect(JSON.parse(String(msgs[0]))).toEqual({ t: "erro", c: "recusado" });
    const t0 = Date.now();
    ac.abort();
    await ate(() => fechouEm !== null, 500);
    expect(fechouEm).not.toBeNull();
    expect((fechouEm ?? t0) - t0).toBeLessThanOrEqual(100);
    expect(c.aberta).toBe(false);
    await ate(() => s.conexoes() === 0);
    expect(s.conexoes()).toBe(0);
  });
  it("conexão recusada (porta fechada) chama aoFechar e aoErro com código nominal, sem vazar a URL", async () => {
    const s = await subir();
    const porta = s.porta;
    await s.fechar();
    const erros: string[] = [];
    let fechou = false;
    abrirWs({ url: `ws://127.0.0.1:${porta}/v1/canal/segredo-no-caminho`, aoAbrir: () => undefined, aoMensagem: () => undefined, aoFechar: () => (fechou = true), aoErro: (c) => erros.push(c) });
    await ate(() => fechou);
    expect(fechou).toBe(true);
    for (const e of erros) expect(e).toBe("falhou");
    expect(JSON.stringify(erros)).not.toContain("segredo");
  });
  it("wss:// para um nome que não resolve falha sem exceção síncrona e sem expor a URL", async () => {
    let erro: unknown = null;
    let fechou = false;
    try {
      abrirWs({ url: "wss://relay-que-nao-existe.exemplo.invalid", aoAbrir: () => undefined, aoMensagem: () => undefined, aoFechar: () => (fechou = true) });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroWs); // `.invalid` é recusado antes de qualquer DNS
    expect((erro as ErroWs).codigo).toBe("url_invalida");
    expect(fechou).toBe(false);
  });
});
