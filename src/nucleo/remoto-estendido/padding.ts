// Padding dos quadros do relay (T-22.09, D-355). Aplicado ao CLARO, ANTES de selar: o relay só vê o tamanho do bloco (+28 B de invólucro), nunca o comprimento real. Blocos de 256 B / 1 KiB
// / 4 KiB (acima disso, múltiplos de 4 KiB) e quadros de ENCHIMENTO indistinguíveis dos de dado depois de selados. Espelho de `pwa/padding.js`.
//   [tipo:1 (0 dado, 1 enchimento)] [comprimento:2 BE] [conteúdo] [bytes aleatórios até o bloco]
import { randomBytes } from "node:crypto";

export const BLOCOS = [256, 1024, 4096] as const;
export const CABECALHO = 3;
export const MAX_CONTEUDO = 15 * 4096 - CABECALHO;
export const SOBRECARGA_ENVELOPE = 28; // nonce 12 + tag 16

export function tamanhoDoBloco(n: number): number {
  for (const b of BLOCOS) if (n <= b) return b;
  return Math.ceil(n / 4096) * 4096;
}
/** `conteudo` null = quadro de enchimento. Lança `RangeError("quadro_grande")` acima do teto. */
export function preencher(conteudo: Uint8Array | null, aleatorio: (n: number) => Uint8Array = randomBytes, tamanhoEnchimento = 256): Buffer {
  const c = conteudo ?? new Uint8Array(0);
  if (c.length > MAX_CONTEUDO) throw new RangeError("quadro_grande");
  const total = conteudo === null ? tamanhoEnchimento : tamanhoDoBloco(CABECALHO + c.length);
  const out = Buffer.alloc(total);
  out[0] = conteudo === null ? 1 : 0;
  out.writeUInt16BE(c.length, 1);
  out.set(c, CABECALHO);
  const resto = total - CABECALHO - c.length;
  if (resto > 0) out.set(aleatorio(resto), CABECALHO + c.length);
  return out;
}
export type QuadroPreenchido = { tipo: "dado"; conteudo: Buffer } | { tipo: "enchimento"; conteudo: Buffer };
/** `null` se o quadro for inválido (tipo, comprimento ou tamanho fora do bloco). Nunca lança. */
export function remover(q: Uint8Array): QuadroPreenchido | null {
  if (q.length < CABECALHO || q.length > 15 * 4096) return null;
  const b = Buffer.from(q.buffer, q.byteOffset, q.byteLength);
  const tipo = b[0];
  const len = b.readUInt16BE(1);
  if ((tipo !== 0 && tipo !== 1) || CABECALHO + len > b.length) return null;
  if (tipo === 1 && len !== 0) return null;
  if (tipo === 0 && b.length !== tamanhoDoBloco(CABECALHO + len)) return null;
  return { tipo: tipo === 0 ? "dado" : "enchimento", conteudo: b.subarray(CABECALHO, CABECALHO + len) };
}
