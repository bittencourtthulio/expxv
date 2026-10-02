import { describe, expect, it } from "vitest";
import { abrirWs, ErroWs, type ConstrutorWs } from "./ws-cliente";

class WsFalso {
  static ultimo: WsFalso | null = null;
  static total = 0;
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "blob";
  enviados: unknown[] = [];
  fechadoCom: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    WsFalso.ultimo = this;
    WsFalso.total++;
  }
  send(d: unknown): void {
    this.enviados.push(d);
  }
  close(c = 1000): void {
    this.fechadoCom = c;
    this.readyState = 3;
    this.onclose?.({ code: c });
  }
}
const ctor = WsFalso as unknown as ConstrutorWs;
const cb = { aoAbrir: () => undefined, aoMensagem: () => undefined, aoFechar: () => undefined };
const codigo = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof ErroWs ? e.codigo : "outro";
  }
  return "nenhum";
};

describe("ws-cliente (T-22.05)", () => {
  it("ax22_so_wss_fora_do_teste: ws:// só em 127.0.0.1 com NODE_ENV=test; credencial, IP privado e redirecionamento recusados", () => {
    const base = { ...cb, ctor, ambiente: "production" };
    expect(codigo(() => abrirWs({ ...base, url: "ws://127.0.0.1:9" }))).toBe("url_insegura");
    expect(codigo(() => abrirWs({ ...base, url: "ws://relay.exemplo.com" }))).toBe("url_insegura");
    expect(codigo(() => abrirWs({ ...base, url: "wss://u:p@relay.exemplo.com" }))).toBe("url_invalida");
    expect(codigo(() => abrirWs({ ...base, url: "wss://192.168.0.2" }))).toBe("url_invalida");
    expect(codigo(() => abrirWs({ ...base, url: "wss://relay.exemplo.com?x=1" }))).toBe("url_invalida");
    expect(codigo(() => abrirWs({ ...base, url: "https://relay.exemplo.com" }))).toBe("url_invalida");
    expect(codigo(() => abrirWs({ ...cb, ctor, ambiente: "test", url: "ws://192.168.0.2:9" }))).toBe("url_insegura");
    expect(codigo(() => abrirWs({ ...cb, ctor, ambiente: "test", url: "ws://127.0.0.1:9" }))).toBe("nenhum");
    expect(codigo(() => abrirWs({ ...base, url: "wss://relay.exemplo.com" }))).toBe("nenhum");
  });
  it("sem WebSocket global o código é nominal (fallback documentado: sem relay)", () => {
    expect(codigo(() => abrirWs({ ...cb, url: "wss://relay.exemplo.com", ctor: null }))).toBe("sem_websocket");
  });
  it("mensagens de erro nunca contêm a URL", () => {
    for (const url of ["wss://segredo.exemplo.com/caminho-secreto", "ws://segredo.exemplo.com/x"]) {
      try {
        abrirWs({ ...cb, ctor, ambiente: "production", url });
      } catch (e) {
        expect(String((e as Error).message)).not.toMatch(/segredo|caminho/);
      }
    }
  });
  it("cancelar pelo sinal fecha o socket de imediato; fechar() deixa 0 sockets", () => {
    WsFalso.total = 0;
    const ac = new AbortController();
    const c = abrirWs({ ...cb, ctor, url: "wss://relay.exemplo.com", sinal: ac.signal });
    const ws = WsFalso.ultimo as WsFalso;
    expect(ws.binaryType).toBe("arraybuffer");
    ac.abort();
    expect(ws.fechadoCom).not.toBeNull();
    expect(c.aberta).toBe(false);
    const c2 = abrirWs({ ...cb, ctor, url: "wss://relay.exemplo.com" });
    c2.fechar();
    expect(c2.aberta).toBe(false);
    expect(abrirWs({ ...cb, ctor, url: "wss://relay.exemplo.com", sinal: AbortSignal.abort() }).aberta).toBe(false);
  });
  it("tetos: quadro grande demais recusado no envio e na recepção; fila cheia fecha", () => {
    const recebidos: unknown[] = [];
    const fechos: number[] = [];
    const c = abrirWs({ ...cb, ctor, url: "wss://relay.exemplo.com", maxQuadro: 100, maxFila: 500, aoMensagem: (d) => recebidos.push(d), aoFechar: (x) => fechos.push(x) });
    const ws = WsFalso.ultimo as WsFalso;
    ws.readyState = 1;
    expect(c.enviar(new Uint8Array(100))).toBe(true);
    expect(c.enviar(new Uint8Array(101))).toBe(false);
    ws.onmessage?.({ data: new ArrayBuffer(50) });
    expect(recebidos).toHaveLength(1);
    ws.onmessage?.({ data: new ArrayBuffer(101) });
    expect(recebidos).toHaveLength(1);
    expect(ws.fechadoCom).toBe(1009);
    expect(fechos).toEqual([1009]);
    const c2 = abrirWs({ ...cb, ctor, url: "wss://relay.exemplo.com", maxQuadro: 100, maxFila: 500 });
    const ws2 = WsFalso.ultimo as WsFalso;
    ws2.readyState = 1;
    ws2.bufferedAmount = 501;
    expect(c2.enviar(new Uint8Array(10))).toBe(false);
    expect(ws2.fechadoCom).not.toBeNull();
  });
  it("erros do socket viram código nominal sem repassar o objeto de erro", () => {
    const erros: string[] = [];
    abrirWs({ ...cb, ctor, url: "wss://relay.exemplo.com", aoErro: (c) => erros.push(c) });
    (WsFalso.ultimo as WsFalso).onerror?.();
    expect(erros).toEqual(["falhou"]);
  });
  it("falha ANTES de abrir é terminal (o Node 22 dispara só `error`, sem `close`): aoFechar(1006) vem do próprio cliente", () => {
    const fechos: number[] = [];
    abrirWs({ ...cb, ctor, url: "wss://relay.exemplo.com", aoFechar: (c) => fechos.push(c) });
    const ws = WsFalso.ultimo as WsFalso;
    ws.readyState = 0;
    ws.onerror?.();
    ws.onerror?.();
    expect(fechos).toEqual([1006]); // uma vez só
  });
});
