// ZIP "store" (sem compressão) próprio, com CRC32 (T-19.21): zero dependência. Nomes recusados se tiverem `..`, barra inicial, barra invertida, controle ou unidade de disco.
import { invalido } from "../erros";

let TABELA: Uint32Array | null = null;
export function crc32(dados: Uint8Array): number {
  if (TABELA === null) {
    TABELA = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABELA[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = (TABELA[(c ^ (dados[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export const nomeZipSeguro = (n: string): boolean => n.length > 0 && n.length < 200 && !n.startsWith("/") && !n.includes("\\") && !n.split("/").includes("..") && !n.split("/").includes(".") && !/[\u0000-\u001f]/.test(n) && !/^[A-Za-z]:/.test(n);

export interface EntradaZip { nome: string; dados: Uint8Array }
export function criarZip(entradas: readonly EntradaZip[], quando: Date): Uint8Array {
  const dosHora = ((quando.getUTCHours() << 11) | (quando.getUTCMinutes() << 5) | (quando.getUTCSeconds() >> 1)) & 0xffff;
  const dosData = ((Math.max(0, quando.getUTCFullYear() - 1980) << 9) | ((quando.getUTCMonth() + 1) << 5) | quando.getUTCDate()) & 0xffff;
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const e of entradas) {
    if (!nomeZipSeguro(e.nome)) throw invalido("nome de arquivo inválido para o ZIP");
    const nome = enc.encode(e.nome);
    const crc = crc32(e.dados);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosHora, true); local.setUint16(12, dosData, true); local.setUint32(14, crc, true); local.setUint32(18, e.dados.length, true); local.setUint32(22, e.dados.length, true);
    local.setUint16(26, nome.length, true); local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nome, e.dados);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosHora, true); c.setUint16(14, dosData, true); c.setUint32(16, crc, true); c.setUint32(20, e.dados.length, true); c.setUint32(24, e.dados.length, true);
    c.setUint16(28, nome.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nome);
    offset += 30 + nome.length + e.dados.length;
  }
  const tamCentral = central.reduce((a, b) => a + b.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, entradas.length, true); fim.setUint16(10, entradas.length, true); fim.setUint32(12, tamCentral, true); fim.setUint32(16, offset, true);
  const todos = [...partes, ...central, new Uint8Array(fim.buffer)];
  const out = new Uint8Array(todos.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const t of todos) { out.set(t, p); p += t.length; }
  return out;
}
