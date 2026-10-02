import { describe, expect, it } from "vitest";
import { BYTES_POR_MS, criarAcumulador, duracaoMs, montarWav, rmsDoBloco } from "./wav";

/** PCM16 de onda quadrada alta (energia clara). */
const fala = (ms: number): Uint8Array => {
  const n = Math.floor(ms * 16);
  const b = new Uint8Array(n * 2);
  const v = new DataView(b.buffer);
  for (let i = 0; i < n; i++) v.setInt16(i * 2, i % 2 === 0 ? 8000 : -8000, true);
  return b;
};
const silencio = (ms: number): Uint8Array => new Uint8Array(Math.floor(ms * 16) * 2);

describe("acumulador de fala e WAV", () => {
  it("cabeçalho WAV de 44 bytes correto (PCM, mono, 16 kHz, 16 bit)", () => {
    const wav = montarWav(new Uint8Array(3200));
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe("WAVE");
    expect(v.getUint32(4, true)).toBe(36 + 3200);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint32(28, true)).toBe(32_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(3200);
    expect(wav.byteLength).toBe(44 + 3200);
  });

  it("120 s = 3 840 000 bytes de PCM e o que passa disso é cortado", () => {
    const a = criarAcumulador();
    const bloco = new Uint8Array(65_536).fill(1);
    for (let i = 0; i < 70; i++) a.adicionar(i, bloco);
    expect(a.bytes).toBe(3_840_000);
    expect(a.duracaoMs).toBe(120_000);
    expect(a.cortada).toBe(true);
    expect(BYTES_POR_MS).toBe(32);
  });

  it("descarta duplicado, fora de ordem, bloco grande demais e bloco ímpar", () => {
    const a = criarAcumulador();
    expect(a.adicionar(0, fala(100))).toBe(true);
    expect(a.adicionar(0, fala(100))).toBe(false);
    expect(a.adicionar(2, fala(100))).toBe(true);
    expect(a.adicionar(1, fala(100))).toBe(false);
    expect(a.adicionar(3, new Uint8Array(65_538))).toBe(false);
    expect(a.adicionar(4, new Uint8Array(3))).toBe(false);
    expect(a.duracaoMs).toBe(200);
  });

  it("299 ms é descartado (fala_curta) e 300 ms é aceito", () => {
    const curta = criarAcumulador();
    curta.adicionar(0, fala(299));
    expect(curta.finalizar()).toEqual({ ok: false, motivo: "fala_curta" });
    const ok = criarAcumulador();
    ok.adicionar(0, fala(300));
    const r = ok.finalizar();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.duracao_ms).toBe(300);
  });

  it("silêncio não chega ao motor (fala_vazia)", () => {
    const a = criarAcumulador();
    a.adicionar(0, silencio(1_000));
    expect(a.finalizar()).toEqual({ ok: false, motivo: "fala_vazia" });
    expect(rmsDoBloco(silencio(10))).toBe(0);
    expect(rmsDoBloco(fala(10))).toBeGreaterThan(0.2);
  });

  it("zerar deixa o buffer vazio e finalizar também zera", () => {
    const a = criarAcumulador();
    a.adicionar(0, fala(500));
    a.zerar();
    expect(a.bytes).toBe(0);
    a.adicionar(0, fala(500));
    a.finalizar();
    expect(a.bytes).toBe(0);
    expect(duracaoMs(64_000)).toBe(2_000);
  });
});
