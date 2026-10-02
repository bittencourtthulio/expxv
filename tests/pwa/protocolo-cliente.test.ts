// T-22.14/T-22.15: o protocolo do cliente web espelha o host. Vetores cruzados (node:crypto x WebCrypto), parser do link, uso único do fragmento, PIN local e autolock.
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canalEfemero, chaveEfemera, segredoEfemero as segredoHost } from "../../src/nucleo/remoto-estendido/pareamento-relay";
import { impressaoHex, agruparImpressao } from "../../src/nucleo/remoto-estendido/impressao-digital";
import { carregar } from "./carregar";

interface PC {
  segredoEfemero(c: string): Promise<Uint8Array>;
  impressaoDigital(b: Uint8Array): Promise<string>;
  grupos4(h: string): string;
  lerLinkPareamento(t: string, o?: { permitirLoopback?: boolean }): { relay: string; codigo: string; host: string; pwa: string } | null;
  consumirFragmento(loc: { hash: string; pathname: string; search: string }, hist: { replaceState(...a: unknown[]): void }, o?: object): ReturnType<PC["lerLinkPareamento"]>;
  urlValidaRelay(u: string, l?: boolean): boolean;
  urlDoCanal(u: string): string;
  backoffMs(t: number, a: () => number): number;
}
interface Trava {
  criarTrava(o: { ms?: number; agendar(fn: () => void, ms: number): () => void; aoTravar(): void }): { iniciar(): void; atividade(): void; parar(): void; ativa(): boolean };
  cifrarComPin(pin: string, d: Uint8Array, it?: number): Promise<{ sal: string; iv: string; ct: string; it: number }>;
  decifrarComPin(pin: string, o: unknown): Promise<Uint8Array | null>;
  pinValido(p: string): boolean;
}
interface Cripto {
  canalId(s: Uint8Array, e: number): Promise<string>;
  chaveEnvelope(s: Uint8Array, r: string): Promise<Uint8Array>;
}
const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const CODIGO = "ABCD-EFGH-JKMN";

describe("protocolo do cliente web: vetores cruzados com o host", async () => {
  const pc = await carregar<PC>("pwa/protocolo-cliente.js");
  const cripto = await carregar<Cripto>("pwa/cripto.js");

  it("segredo efêmero, canal efêmero e chave do invólucro do pareamento: bytes idênticos ao host (com e sem hífen, caixa baixa)", async () => {
    for (const c of [CODIGO, "abcdefghjkmn", " ABCD EFGH JKMN "]) {
      const s = await pc.segredoEfemero(c);
      expect(eq(s, new Uint8Array(segredoHost(c)))).toBe(true);
      expect(await cripto.canalId(s, 0)).toBe(canalEfemero(c));
      expect(eq(await cripto.chaveEnvelope(s, "pareamento"), new Uint8Array(chaveEfemera(c)))).toBe(true);
    }
  });
  it("impressão digital: 16 primeiros bytes de SHA-256 em 32 hex, igual ao host, em grupos de 4", async () => {
    for (let i = 0; i < 10; i++) {
      const spki = randomBytes(91);
      const hex = await pc.impressaoDigital(new Uint8Array(spki));
      expect(hex).toBe(impressaoHex(spki));
      expect(hex).toBe(createHash("sha256").update(spki).digest("hex").slice(0, 32));
      expect(pc.grupos4(hex)).toBe(agruparImpressao(hex));
    }
  });
  it("link de pareamento: aceita o formato do host e recusa o resto", () => {
    const h = "a".repeat(32);
    const ok = pc.lerLinkPareamento(`#r=${encodeURIComponent("wss://relay.exemplo.com")}&c=ABCDEFGHJKMN&h=${h}&p=`);
    expect(ok).toEqual({ relay: "wss://relay.exemplo.com", codigo: "ABCDEFGHJKMN", host: h, pwa: "" });
    expect(pc.lerLinkPareamento(`r=${encodeURIComponent("wss://relay.exemplo.com/v1/canal/x")}&c=ABCD-EFGH-JKMN&h=${h}&p=${h}`)?.pwa).toBe(h);
    for (const ruim of ["", "#", "#r=ws://relay.exemplo.com&c=ABCDEFGHJKMN&h=", `#r=wss://u:p@relay.exemplo.com&c=ABCDEFGHJKMN`, "#r=wss://10.0.0.1&c=ABCDEFGHJKMN", "#r=wss://relay.exemplo.com&c=ABCDEFGHJKM0", "#r=wss://relay.exemplo.com&c=ABCDEFGHJKMN&h=zz", "#r=wss://relay.exemplo.com?x=1&c=ABCDEFGHJKMN", `#${"a=b&".repeat(300)}`]) expect(pc.lerLinkPareamento(ruim), ruim).toBeNull();
    expect(pc.lerLinkPareamento("#r=ws://127.0.0.1:9&c=ABCDEFGHJKMN")).toBeNull();
    expect(pc.lerLinkPareamento("#r=ws://127.0.0.1:9&c=ABCDEFGHJKMN", { permitirLoopback: true })).not.toBeNull();
  });
  it("ax26_qr_uso_unico_ttl (PWA): o fragmento é lido UMA vez e apagado da barra; reabrir o mesmo link não repete", () => {
    const loc = { hash: `#r=${encodeURIComponent("wss://relay.exemplo.com")}&c=ABCDEFGHJKMN&h=&p=`, pathname: "/pwa/", search: "" };
    const chamadas: unknown[][] = [];
    const hist = { replaceState: (...a: unknown[]) => void chamadas.push(a) };
    expect(pc.consumirFragmento(loc, hist)?.codigo).toBe("ABCDEFGHJKMN");
    expect(chamadas).toEqual([[null, "", "/pwa/"]]);
    loc.hash = ""; // o navegador limpou a barra
    expect(pc.consumirFragmento(loc, hist)).toBeNull();
    // fragmento inválido também é apagado (nada de código no histórico)
    loc.hash = "#c=qualquer-coisa";
    expect(pc.consumirFragmento(loc, hist)).toBeNull();
    expect(chamadas).toHaveLength(2);
  });
  it("URL do relay: só wss:// (nome público) e caminho padrão /v1/canal/", () => {
    expect(pc.urlValidaRelay("wss://relay.exemplo.com")).toBe(true);
    for (const u of ["ws://relay.exemplo.com", "wss://localhost", "wss://relay", "wss://1.2.3.4", "wss://a.b?c=1", "https://a.b", "wss://x.local"]) expect(pc.urlValidaRelay(u), u).toBe(false);
    expect(pc.urlDoCanal("wss://relay.exemplo.com")).toBe("wss://relay.exemplo.com/v1/canal/x");
    expect(pc.urlDoCanal("ws://127.0.0.1:99/v1/canal/z")).toBe("ws://127.0.0.1:99/v1/canal/z");
  });
  it("backoff 1->60 s com jitter ±20 %", () => {
    expect(pc.backoffMs(0, () => 0.5)).toBe(1000);
    expect(pc.backoffMs(0, () => 0)).toBe(800);
    expect(pc.backoffMs(3, () => 1)).toBe(9600);
    expect(pc.backoffMs(20, () => 1)).toBe(60000);
  });
});

describe("trava: PIN local e autolock", async () => {
  const t = await carregar<Trava>("pwa/trava.js");
  it("o PIN protege o USO do segredo: certo abre, errado e adulterado não; o PIN nunca fica no registro", async () => {
    const segredo = new Uint8Array(randomBytes(32));
    const r = await t.cifrarComPin("1234", segredo, 1000);
    expect(JSON.stringify(r)).not.toContain("1234");
    expect(eq((await t.decifrarComPin("1234", r)) as Uint8Array, segredo)).toBe(true);
    expect(await t.decifrarComPin("1235", r)).toBeNull();
    expect(await t.decifrarComPin("1234", { ...r, ct: r.ct.slice(0, -4) + "AAAA" })).toBeNull();
    expect(await t.decifrarComPin("1234", { ...r, it: 1 })).toBeNull();
    expect(await t.decifrarComPin("1234", null)).toBeNull();
    expect(t.pinValido("1234")).toBe(true);
    for (const p of ["123", "1234567890123", "12a4", "", "  12 34"]) expect(t.pinValido(p), p).toBe(false);
  });
  it("autolock: dispara depois de 5 min sem atividade; atividade rearma; parar cancela", () => {
    const agendados: Array<{ fn: () => void; ms: number; vivo: boolean }> = [];
    let travou = 0;
    const tr = t.criarTrava({ agendar: (fn, ms) => { const a = { fn, ms, vivo: true }; agendados.push(a); return () => void (a.vivo = false); }, aoTravar: () => void travou++ });
    tr.atividade(); // sem iniciar: nada
    expect(agendados).toHaveLength(0);
    tr.iniciar();
    expect(agendados[0]?.ms).toBe(300000);
    tr.atividade();
    expect(agendados[0]?.vivo).toBe(false);
    expect(agendados[1]?.vivo).toBe(true);
    agendados[1]?.fn();
    expect(travou).toBe(1);
    expect(tr.ativa()).toBe(false);
    tr.iniciar();
    tr.parar();
    expect(agendados[2]?.vivo).toBe(false);
  });
});
