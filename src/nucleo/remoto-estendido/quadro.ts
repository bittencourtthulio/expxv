// Invólucro dos quadros que atravessam o relay (T-22.10). Ordem: JSON -> PADDING -> AES-256-GCM (nonce aleatório de 96 bits, AAD com a DIREÇÃO, para um quadro não ser refletido) -> bytes.
// O relay vê só `nonce‖cifra‖tag` com tamanho de bloco + 28 B. Por dentro seguem, intactos, o pareamento/sessão/canal da Fase 13 (cifrados de novo pelo canal AES-GCM da sessão, com
// contador e AAD do `sid`). O parser é estrito e NUNCA lança: o que não abre nem decodifica vira `null` e quem chamou descarta ou fecha.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { preencher, remover, SOBRECARGA_ENVELOPE } from "./padding";

export type Direcao = "c2h" | "h2c";
export const aadEnvelope = (d: Direcao): Buffer => Buffer.from(`xv-relay-env-v1|${d}`);

export function selar(chave: Buffer, claro: Uint8Array, d: Direcao, bytes: (n: number) => Buffer = randomBytes): Buffer {
  const iv = bytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  c.setAAD(aadEnvelope(d));
  return Buffer.concat([iv, c.update(claro), c.final(), c.getAuthTag()]);
}
export function abrir(chave: Buffer, selado: Uint8Array, d: Direcao): Buffer | null {
  if (selado.length < SOBRECARGA_ENVELOPE + 3) return null;
  const b = Buffer.from(selado.buffer, selado.byteOffset, selado.byteLength);
  try {
    const dec = createDecipheriv("aes-256-gcm", chave, b.subarray(0, 12));
    dec.setAAD(aadEnvelope(d));
    dec.setAuthTag(b.subarray(b.length - 16));
    return Buffer.concat([dec.update(b.subarray(12, b.length - 16)), dec.final()]);
  } catch {
    return null;
  }
}

/** Mensagem JSON -> quadro opaco para o relay. `padding:false` só em teste (o padrão é sempre preencher). */
export function codificar(chave: Buffer, mensagem: unknown, d: Direcao, o: { aleatorio?: (n: number) => Buffer } = {}): Buffer {
  const claro = Buffer.from(JSON.stringify(mensagem), "utf8");
  return selar(chave, preencher(claro, o.aleatorio), d, o.aleatorio);
}
/** quadro de enchimento (mesmo formato; indistinguível de um dado para quem não tem a chave). */
export const codificarEnchimento = (chave: Buffer, d: Direcao, o: { aleatorio?: (n: number) => Buffer } = {}): Buffer => selar(chave, preencher(null, o.aleatorio), d, o.aleatorio);

export type Decodificado = { tipo: "dado"; mensagem: unknown; nonce: string } | { tipo: "enchimento"; nonce: string };
/** `null` = não autêntico, adulterado ou malformado. */
export function decodificar(chave: Buffer, quadro: Uint8Array, d: Direcao): Decodificado | null {
  const claro = abrir(chave, quadro, d);
  if (claro === null) return null;
  const p = remover(claro);
  if (p === null) return null;
  const nonce = Buffer.from(quadro.buffer, quadro.byteOffset, 12).toString("hex");
  if (p.tipo === "enchimento") return { tipo: "enchimento", nonce };
  try {
    return { tipo: "dado", mensagem: JSON.parse(p.conteudo.toString("utf8")) as unknown, nonce };
  } catch {
    return null;
  }
}
