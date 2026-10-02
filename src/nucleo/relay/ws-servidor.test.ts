import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aceitarChave, chaveValida, criarLeitor, quadro, quadroFechar } from "./ws-servidor";

const mascarar = (op: number, dados: Buffer, o: { fin?: boolean; rsv?: number; semMascara?: boolean } = {}): Buffer => {
  const m = randomBytes(4);
  const n = dados.length;
  const b0 = (o.fin === false ? 0 : 0x80) | (o.rsv ?? 0) | op;
  const mk = o.semMascara === true ? 0 : 0x80;
  const cab = n < 126 ? Buffer.from([b0, mk | n]) : n < 65536 ? Buffer.from([b0, mk | 126, n >> 8, n & 255]) : Buffer.from([b0, mk | 127, 0, 0, 0, 0, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const corpo = Buffer.from(dados);
  if (o.semMascara !== true) for (let i = 0; i < n; i++) corpo[i] = (corpo[i] as number) ^ (m[i % 4] as number);
  return Buffer.concat([cab, o.semMascara === true ? Buffer.alloc(0) : m, corpo]);
};

describe("WebSocket mínimo (RFC 6455, lado servidor)", () => {
  it("vetor do RFC 6455 §1.3: a chave de exemplo gera o Sec-WebSocket-Accept do exemplo", () => {
    expect(aceitarChave("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    expect(chaveValida("dGhlIHNhbXBsZSBub25jZQ==")).toBe(true);
    for (const x of ["", "curta", "dGhlIHNhbXBsZSBub25jZQ", 5, null, "!".repeat(24)]) expect(chaveValida(x)).toBe(false);
  });
  it("vetor do RFC §5.7: quadro mascarado «Hello» é lido; o do servidor sai sem máscara", () => {
    const l = criarLeitor(() => 1024);
    const ev = l.alimentar(Buffer.from([0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58]));
    expect(ev).toEqual([{ op: "texto", dados: Buffer.from("Hello") }]);
    expect(quadro("texto", "Hello")).toEqual(Buffer.from([0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f]));
  });
  it("texto, binário, ping e fechar; tamanhos 7/16 bits; chegada em pedaços (byte a byte)", () => {
    for (const n of [0, 1, 125, 126, 1000, 65535, 65536]) {
      const d = randomBytes(n);
      const q = mascarar(2, d);
      const l = criarLeitor(() => 70_000);
      const ev: unknown[] = [];
      for (const b of q) ev.push(...l.alimentar(Buffer.from([b])));
      expect(ev).toHaveLength(1);
      expect((ev[0] as { dados: Buffer }).dados.equals(d)).toBe(true);
    }
    const l = criarLeitor(() => 1000);
    expect(l.alimentar(Buffer.concat([mascarar(9, Buffer.from("p")), mascarar(1, Buffer.from("t")), mascarar(8, Buffer.from([3, 232]))])).map((e) => ("op" in e ? e.op : "erro"))).toEqual(["ping", "texto", "fechar"]);
    expect(l.alimentar(mascarar(1, Buffer.from("depois do close")))).toEqual([]); // depois de fechar, ignora
  });
  it("viola o protocolo: sem máscara, bits reservados, fragmentado, opcode desconhecido, controle grande, tamanho acima do limite (sem ler o corpo)", () => {
    const erro = (b: Buffer, lim = 1000): number | undefined => {
      const e = criarLeitor(() => lim).alimentar(b)[0];
      return e !== undefined && "erro" in e ? e.erro : undefined;
    };
    expect(erro(mascarar(1, Buffer.from("x"), { semMascara: true }))).toBe(1002);
    expect(erro(mascarar(1, Buffer.from("x"), { rsv: 0x40 }))).toBe(1002);
    expect(erro(mascarar(1, Buffer.from("x"), { fin: false }))).toBe(1003);
    expect(erro(mascarar(0, Buffer.from("x")))).toBe(1003);
    expect(erro(mascarar(3, Buffer.from("x")))).toBe(1002);
    expect(erro(mascarar(9, Buffer.alloc(126)))).toBe(1002);
    expect(erro(mascarar(1, Buffer.alloc(1001)))).toBe(1009);
    // só o cabeçalho de um quadro de 1 GiB já fecha, sem esperar nem acumular o corpo
    expect(erro(Buffer.from([0x82, 0xff, 0, 0, 0, 0, 0x40, 0, 0, 0, 1, 2, 3, 4]))).toBe(1009);
    expect(erro(Buffer.from([0x82, 0xff, 0, 0, 0, 1, 0, 0, 0, 0, 1, 2, 3, 4]))).toBe(1009);
  });
  it("o limite é consultado a cada quadro (1 KiB antes da autenticação, 64 KiB depois)", () => {
    let lim = 1024;
    const l = criarLeitor(() => lim);
    expect(l.alimentar(mascarar(2, Buffer.alloc(2000)))[0]).toEqual({ erro: 1009 });
    const l2 = criarLeitor(() => lim);
    lim = 65536;
    expect(l2.alimentar(mascarar(2, Buffer.alloc(2000)))[0]).toMatchObject({ op: "binario" });
  });
  it("o leitor nunca lança com lixo", () => {
    for (let i = 0; i < 3000; i++) expect(() => criarLeitor(() => 500).alimentar(randomBytes(1 + (i % 200)))).not.toThrow();
  });
  it("quadro de fechamento carrega o código", () => {
    expect(quadroFechar(1008)).toEqual(Buffer.from([0x88, 0x02, 0x03, 0xf0]));
    expect(quadro("binario", new Uint8Array(70_000))).toHaveLength(70_000 + 10);
  });
});
