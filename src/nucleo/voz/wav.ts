// Acumulador de fala e WAV (Fase 11, T-11.05): PCM16 LE, 16 kHz, mono, em memória. Blocos em ordem (`sequencia`); duplicado e fora de ordem são descartados; teto de 120 s;
// fala < 300 ms e silêncio são descartados antes do motor; `zerar()` sobrescreve o buffer. Sem I/O.
import { LIMITES_VOZ } from "../../compartilhado/captura";

export const BYTES_POR_AMOSTRA = 2;
export const BYTES_POR_MS = (LIMITES_VOZ.taxa_hz * BYTES_POR_AMOSTRA) / 1000; // 32

export function duracaoMs(bytesPcm: number): number {
  return Math.floor(bytesPcm / BYTES_POR_MS);
}

/** Cabeçalho WAV de 44 bytes + PCM. */
export function montarWav(pcm: Uint8Array, taxaHz: number = LIMITES_VOZ.taxa_hz): Uint8Array {
  const out = new Uint8Array(44 + pcm.byteLength);
  const v = new DataView(out.buffer);
  const texto = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  texto(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, taxaHz, true);
  v.setUint32(28, taxaHz * BYTES_POR_AMOSTRA, true);
  v.setUint16(32, BYTES_POR_AMOSTRA, true);
  v.setUint16(34, 16, true);
  texto(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}

/** RMS normalizado (0..1) de um bloco PCM16 LE. */
export function rmsDoBloco(dados: Uint8Array): number {
  const n = Math.floor(dados.byteLength / 2);
  if (n === 0) return 0;
  const v = new DataView(dados.buffer, dados.byteOffset, n * 2);
  let soma = 0;
  for (let i = 0; i < n; i++) { const a = v.getInt16(i * 2, true) / 32768; soma += a * a; }
  return Math.sqrt(soma / n);
}

export type MotivoDescarte = "fala_curta" | "fala_vazia";

export interface OpcoesAcumulador {
  /** RMS abaixo disso (média da fala inteira) = silêncio. */
  limiar_energia?: number;
  max_bytes?: number;
}

export interface Acumulador {
  /** devolve `false` se o bloco foi descartado (duplicado, fora de ordem, grande demais ou acima do teto). */
  adicionar(sequencia: number, dados: Uint8Array): boolean;
  readonly bytes: number;
  readonly duracaoMs: number;
  /** `true` se o teto de 120 s foi atingido (a fala foi cortada). */
  readonly cortada: boolean;
  /** Fecha a fala: WAV pronto ou o motivo do descarte. Zera o buffer interno em seguida. */
  finalizar(): { ok: true; wav: Uint8Array; duracao_ms: number; cortada: boolean } | { ok: false; motivo: MotivoDescarte };
  zerar(): void;
}

export function criarAcumulador(op: OpcoesAcumulador = {}): Acumulador {
  const limiar = op.limiar_energia ?? 0.003;
  const teto = op.max_bytes ?? LIMITES_VOZ.pcm_max_bytes;
  let buffer = new Uint8Array(0);
  let usado = 0;
  let ultima = -1;
  let cortada = false;
  let energia = 0; // soma de rms * bytes (média ponderada)

  const garantir = (n: number): void => {
    if (usado + n <= buffer.byteLength) return;
    const novo = new Uint8Array(Math.min(teto, Math.max(usado + n, buffer.byteLength * 2, 64 * 1024)));
    novo.set(buffer.subarray(0, usado));
    buffer.fill(0);
    buffer = novo;
  };

  return {
    adicionar(sequencia, dados) {
      if (!Number.isInteger(sequencia) || sequencia <= ultima) return false; // duplicado e fora de ordem
      if (dados.byteLength === 0 || dados.byteLength > LIMITES_VOZ.bloco_max_bytes || dados.byteLength % 2 !== 0) return false;
      ultima = sequencia;
      const cabe = teto - usado;
      if (cabe <= 0) { cortada = true; return false; }
      const parte = dados.byteLength > cabe ? dados.subarray(0, cabe - (cabe % 2)) : dados;
      if (parte.byteLength < dados.byteLength) cortada = true;
      garantir(parte.byteLength);
      buffer.set(parte, usado);
      energia += rmsDoBloco(parte) * parte.byteLength;
      usado += parte.byteLength;
      return true;
    },
    get bytes() { return usado; },
    get duracaoMs() { return duracaoMs(usado); },
    get cortada() { return cortada; },
    finalizar() {
      const ms = duracaoMs(usado);
      if (ms < LIMITES_VOZ.fala_min_ms) { this.zerar(); return { ok: false, motivo: "fala_curta" }; }
      if (energia / usado < limiar) { this.zerar(); return { ok: false, motivo: "fala_vazia" }; }
      const wav = montarWav(buffer.subarray(0, usado));
      const r = { ok: true as const, wav, duracao_ms: ms, cortada };
      this.zerar();
      return r;
    },
    zerar() {
      buffer.fill(0);
      buffer = new Uint8Array(0);
      usado = 0;
      ultima = -1;
      cortada = false;
      energia = 0;
    },
  };
}
