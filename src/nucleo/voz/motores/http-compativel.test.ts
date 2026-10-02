import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarClienteRede, criarRegistroConsentimento } from "../../rede";
import { criarMotorHttp, montarMultipart } from "./http-compativel";

const WAV = new Uint8Array(44 + 64);
const CHAVE = "chave-secreta-de-teste-0123456789";
const OPC = { idioma: "pt" as const, modelo: "m1", prompt: "Supabase" };

let servidor: http.Server;
let porta = 0;
let conexoes = 0;
let pedidos: { metodo: string; url: string; auth: string | undefined; tipo: string | undefined; corpo: string }[] = [];
let respostas: { status: number; corpo: unknown }[] = [];

beforeEach(async () => {
  conexoes = 0;
  pedidos = [];
  respostas = [{ status: 200, corpo: { text: "texto remoto" } }];
  servidor = http.createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (c: Buffer) => partes.push(c));
    req.on("end", () => {
      pedidos.push({ metodo: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, tipo: req.headers["content-type"], corpo: Buffer.concat(partes).toString("latin1") });
      const r = respostas.shift() ?? { status: 200, corpo: { text: "texto remoto" } };
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.corpo));
    });
  });
  servidor.on("connection", () => void (conexoes += 1));
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  porta = (servidor.address() as AddressInfo).port;
});
afterEach(async () => {
  if (servidor.listening) await new Promise((r) => servidor.close(r));
});

function montar(consentido: () => boolean, chave: string | null = CHAVE) {
  const registroRede = criarRegistroConsentimento();
  const rede = criarClienteRede({ consentimento: registroRede, permitirLoopbackHttp: true });
  return criarMotorHttp({ url: `http://127.0.0.1:${porta}/v1`, chave: async () => chave, consentido, rede, registroRede, permitirLoopbackHttp: true, timeout_ms: 3_000 });
}

describe("motor HTTP compatível", () => {
  it("sem consentimento: ZERO conexão (nem abre o socket)", async () => {
    const m = montar(() => false);
    await expect(m.transcrever(WAV, OPC)).rejects.toMatchObject({ codigo: "consentimento_ausente" });
    expect(conexoes).toBe(0);
    expect(pedidos).toHaveLength(0);
  });

  it("com consentimento: uma chamada multipart com chave só no cabeçalho e idioma explícito", async () => {
    const m = montar(() => true);
    expect(await m.transcrever(WAV, OPC)).toBe("texto remoto");
    expect(pedidos).toHaveLength(1);
    const p = pedidos[0]!;
    expect(p.metodo).toBe("POST");
    expect(p.url).toBe("/v1/audio/transcriptions");
    expect(p.url).not.toContain("?");
    expect(p.auth).toBe(`Bearer ${CHAVE}`);
    expect(p.tipo).toMatch(/^multipart\/form-data; boundary=/);
    expect(p.corpo).toContain('name="language"\r\n\r\npt');
    expect(p.corpo).toContain('name="model"\r\n\r\nm1');
    expect(p.corpo).toContain('name="prompt"\r\n\r\nSupabase');
    expect(p.corpo).toContain('filename="fala.wav"');
    expect(p.corpo).not.toContain(CHAVE);
  });

  it("401 -> chave_recusada; 429 -> limite_de_uso; sem retry nesses casos", async () => {
    respostas = [{ status: 401, corpo: {} }];
    await expect(montar(() => true).transcrever(WAV, OPC)).rejects.toMatchObject({ codigo: "chave_recusada" });
    respostas = [{ status: 429, corpo: {} }];
    await expect(montar(() => true).transcrever(WAV, OPC)).rejects.toMatchObject({ codigo: "limite_de_uso" });
    expect(pedidos).toHaveLength(2);
  });

  it("5xx tem 1 retry com o mesmo áudio e não perde a fala", async () => {
    respostas = [{ status: 503, corpo: {} }, { status: 200, corpo: { text: "ok no retry" } }];
    expect(await montar(() => true).transcrever(WAV, OPC)).toBe("ok no retry");
    expect(pedidos).toHaveLength(2);
    expect(pedidos[0]!.corpo.length).toBe(pedidos[1]!.corpo.length);
    respostas = [{ status: 500, corpo: {} }, { status: 500, corpo: {} }];
    await expect(montar(() => true).transcrever(WAV, OPC)).rejects.toMatchObject({ codigo: "motor_falhou" });
  });

  it("sem rede: 1 retry e sem_rede; a mensagem nunca cita a chave", async () => {
    const m = montar(() => true);
    await new Promise((r) => servidor.close(r));
    const e = await m.transcrever(WAV, OPC).catch((x: unknown) => x);
    expect((e as { codigo: string }).codigo).toBe("sem_rede");
    expect(String((e as Error).message)).not.toContain(CHAVE);
  });

  it("revogar o consentimento no meio derruba o uso antes da nova tentativa", async () => {
    let chamadas = 0;
    respostas = [{ status: 503, corpo: {} }];
    const m = montar(() => ++chamadas === 1);
    await expect(m.transcrever(WAV, OPC)).rejects.toMatchObject({ codigo: "consentimento_ausente" });
    expect(pedidos).toHaveLength(1);
  });

  it("URL http (fora de teste), URL com query e com credencial são recusadas sem abrir socket", async () => {
    const registroRede = criarRegistroConsentimento();
    const rede = criarClienteRede({ consentimento: registroRede });
    for (const url of [`http://127.0.0.1:${porta}/v1`, "http://exemplo.com/v1", "https://exemplo.com/v1?key=abc", "https://u:p@exemplo.com/v1"]) {
      const m = criarMotorHttp({ url, chave: async () => CHAVE, consentido: () => true, rede, registroRede });
      await expect(m.transcrever(WAV, OPC)).rejects.toMatchObject({ codigo: "motor_ausente" });
    }
    expect(conexoes).toBe(0);
  });

  it("multipart: campos antes do arquivo, fecha o limite e recusa nome de campo ruim", () => {
    const { corpo, tipo } = montarMultipart({ a: "1" }, { campo: "file", nome: "x.wav", tipo: "audio/wav", bytes: new Uint8Array([1, 2, 3]) }, "LIM");
    const t = Buffer.from(corpo).toString("latin1");
    expect(tipo).toBe("multipart/form-data; boundary=LIM");
    expect(t.startsWith('--LIM\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n')).toBe(true);
    expect(t.endsWith("\r\n--LIM--\r\n")).toBe(true);
    expect(() => montarMultipart({ 'a"b': "1" }, { campo: "file", nome: "x.wav", tipo: "audio/wav", bytes: new Uint8Array(1) })).toThrow();
  });
});
