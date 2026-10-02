// Imagem de captura (Fase 11, T-11.15): bitmap cru, recorte, detecção de imagem em branco (sinal de permissão de tela negada), escolha PNG/JPEG e nome de arquivo. Puro.
import { LIMITES_CAPTURA, type FormatoImagem } from "../../compartilhado/captura";
import type { Retangulo } from "./geometria";

/** Bitmap de 4 bytes por pixel (BGRA ou RGBA: a ordem dos canais não importa aqui). */
export interface Bitmap { largura: number; altura: number; dados: Uint8Array }

/** Porta de codificação (nativeImage no main; falsa nos testes). */
export interface Codificador {
  png(b: Bitmap): Uint8Array;
  jpeg(b: Bitmap, qualidade: number): Uint8Array;
}

export function bitmapValido(b: Bitmap): boolean {
  return Number.isInteger(b.largura) && Number.isInteger(b.altura) && b.largura > 0 && b.altura > 0 && b.dados.byteLength === b.largura * b.altura * 4;
}

/**
 * Sem a permissão de Gravação de Tela o macOS entrega miniaturas só com o papel de parede ou transparentes. Aqui: toda a imagem é transparente OU de uma cor só
 * (amostragem determinística de até ~20 mil pixels, espalhada por toda a imagem). Uma tela real nunca é uniforme.
 */
export function imagemEmBranco(b: Bitmap): boolean {
  const total = b.largura * b.altura;
  if (total === 0 || b.dados.byteLength < total * 4) return true;
  const passo = Math.max(1, Math.floor(total / 20_000));
  const d = b.dados;
  const c0 = d[0] ?? 0, c1 = d[1] ?? 0, c2 = d[2] ?? 0, c3 = d[3] ?? 0;
  let transparente = true;
  let uniforme = true;
  for (let p = 0; p < total; p += passo) {
    const i = p * 4;
    if ((d[i + 3] ?? 0) !== 0) transparente = false;
    if (d[i] !== c0 || d[i + 1] !== c1 || d[i + 2] !== c2 || d[i + 3] !== c3) uniforme = false;
    if (!transparente && !uniforme) return false;
  }
  return true;
}

/** Copia só a região (já em pixels físicos). Lança se a região sai do bitmap. */
export function recortarBitmap(b: Bitmap, r: Retangulo): Bitmap {
  if (r.x < 0 || r.y < 0 || r.largura <= 0 || r.altura <= 0 || r.x + r.largura > b.largura || r.y + r.altura > b.altura) throw new Error("Recorte fora da imagem.");
  const saida = new Uint8Array(r.largura * r.altura * 4);
  for (let linha = 0; linha < r.altura; linha++) {
    const origem = ((r.y + linha) * b.largura + r.x) * 4;
    saida.set(b.dados.subarray(origem, origem + r.largura * 4), linha * r.largura * 4);
  }
  return { largura: r.largura, altura: r.altura, dados: saida };
}

/** PNG se couber em 800 KB, senão JPEG q85. */
export function codificarCaptura(b: Bitmap, cod: Codificador): { bytes: Uint8Array; formato: FormatoImagem } {
  const png = cod.png(b);
  if (png.byteLength <= LIMITES_CAPTURA.png_max_bytes) return { bytes: png, formato: "png" };
  return { bytes: cod.jpeg(b, LIMITES_CAPTURA.jpeg_qualidade), formato: "jpeg" };
}

export const EXTENSAO: Record<FormatoImagem, string> = { png: "png", jpeg: "jpg" };

const dois = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DD_HH-mm-ss` (hora local): é também o id da captura. */
export function radicalDeData(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}_${dois(d.getHours())}-${dois(d.getMinutes())}-${dois(d.getSeconds())}`;
}

/** Radical livre: acrescenta `-1`, `-2`… se `existe` já conhece o nome (sem colisão, nunca sobrescreve). */
export function radicalLivre(d: Date, existe: (radical: string) => boolean): string {
  const base = radicalDeData(d);
  if (!existe(base)) return base;
  for (let n = 1; n < 1_000; n++) if (!existe(`${base}-${n}`)) return `${base}-${n}`;
  throw new Error("Não foi possível escolher um nome para a captura.");
}

export const PADRAO_ID_IMAGEM = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d{1,3})?$/;
export const PADRAO_ID_QUADROS = /^q_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d{1,3})?$/;

export function idDeCapturaValido(id: string): boolean {
  return PADRAO_ID_IMAGEM.test(id) || PADRAO_ID_QUADROS.test(id);
}

/** Largura/altura do cabeçalho PNG (IHDR). `null` se não for PNG. */
export function dimensoesPng(b: Uint8Array): { largura: number; altura: number } | null {
  if (b.byteLength < 24) return null;
  const assinatura = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (b[i] !== assinatura[i]) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { largura: v.getUint32(16), altura: v.getUint32(20) };
}

/** Largura/altura de um JPEG (primeiro marcador SOF). `null` se não achar. */
export function dimensoesJpeg(b: Uint8Array): { largura: number; altura: number } | null {
  if (b.byteLength < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 2;
  while (i + 9 < b.byteLength) {
    if (b[i] !== 0xff) { i++; continue; }
    const marcador = b[i + 1] ?? 0;
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7) || marcador === 0xff) { i += marcador === 0xff ? 1 : 2; continue; }
    const tam = v.getUint16(i + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marcador)) return { altura: v.getUint16(i + 5), largura: v.getUint16(i + 7) };
    i += 2 + Math.max(2, tam);
  }
  return null;
}
