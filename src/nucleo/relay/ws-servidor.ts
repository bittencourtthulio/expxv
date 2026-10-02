// Protocolo WebSocket (RFC 6455) MÍNIMO, lado servidor (T-22.08, D-365): sem dependência (nada de `ws`), sem extensões (nada de permessage-deflate: sem bomba de compressão), sem subprotocolos,
// sem fragmentação (mensagem = um quadro), máscara obrigatória do cliente, bits reservados zero, controle ≤ 125 B. PURO: não escuta nem abre socket (quem escuta é `servidor.ts`).
import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const aceitarChave = (chave: string): string => createHash("sha1").update(chave + GUID).digest("base64");
/** `Sec-WebSocket-Key` válida = base64 de 16 bytes. */
export const chaveValida = (c: unknown): c is string => typeof c === "string" && /^[A-Za-z0-9+/]{22}==$/.test(c);

export type OpWs = "texto" | "binario" | "fechar" | "ping" | "pong";
export type EventoWs = { op: OpWs; dados: Buffer } | { erro: number }; // erro = código de fechamento (1002 protocolo, 1003 não suportado, 1009 grande)
const OPS: Record<number, OpWs> = { 1: "texto", 2: "binario", 8: "fechar", 9: "ping", 10: "pong" };

export interface Leitor {
  /** alimenta com bytes do socket; devolve os eventos completos. Depois de um `erro` o leitor ignora tudo. */
  alimentar(chunk: Buffer): EventoWs[];
}
/** `limite()` é consultado a CADA quadro (1 KiB antes da autenticação, 64 KiB depois): quadro maior fecha com 1009 SEM ser lido para a memória. */
export function criarLeitor(limite: () => number): Leitor {
  let buf: Buffer = Buffer.alloc(0);
  let quebrado = false;
  return {
    alimentar(chunk) {
      if (quebrado) return [];
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
      const eventos: EventoWs[] = [];
      for (;;) {
        if (buf.length < 2) break;
        const b0 = buf[0] as number;
        const b1 = buf[1] as number;
        const fin = (b0 & 0x80) !== 0;
        const op = b0 & 0x0f;
        const mascara = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f;
        let desloc = 2;
        const ruim = (cod: number): EventoWs[] => {
          quebrado = true;
          buf = Buffer.alloc(0);
          eventos.push({ erro: cod });
          return eventos;
        };
        if ((b0 & 0x70) !== 0 || !mascara || OPS[op] === undefined || !fin) return ruim(op === 0 || !fin ? 1003 : 1002);
        if (len === 126) {
          if (buf.length < 4) break;
          len = buf.readUInt16BE(2);
          desloc = 4;
        } else if (len === 127) {
          if (buf.length < 10) break;
          const alto = buf.readUInt32BE(2);
          if (alto !== 0) return ruim(1009);
          len = buf.readUInt32BE(6);
          desloc = 10;
        }
        const ctrl = op >= 8;
        if (ctrl && len > 125) return ruim(1002);
        if (!ctrl && len > limite()) return ruim(1009);
        if (buf.length < desloc + 4 + len) break;
        const m = buf.subarray(desloc, desloc + 4);
        const dados = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) dados[i] = (buf[desloc + 4 + i] as number) ^ (m[i % 4] as number);
        buf = buf.subarray(desloc + 4 + len);
        eventos.push({ op: OPS[op] as OpWs, dados });
        if (op === 8) {
          quebrado = true;
          buf = Buffer.alloc(0);
          break;
        }
      }
      return eventos;
    },
  };
}

const CODIGOS: Record<OpWs, number> = { texto: 1, binario: 2, fechar: 8, ping: 9, pong: 10 };
/** Quadro do servidor (nunca mascarado). */
export function quadro(op: OpWs, dados: Uint8Array | string): Buffer {
  const d = typeof dados === "string" ? Buffer.from(dados, "utf8") : Buffer.from(dados.buffer, dados.byteOffset, dados.byteLength);
  const n = d.length;
  const cab = n < 126 ? Buffer.from([0x80 | CODIGOS[op], n]) : n < 65536 ? Buffer.from([0x80 | CODIGOS[op], 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | CODIGOS[op], 127, 0, 0, 0, 0]), Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])]);
  return Buffer.concat([cab, d]);
}
export const quadroFechar = (codigo: number): Buffer => quadro("fechar", Buffer.from([codigo >> 8, codigo & 255]));
