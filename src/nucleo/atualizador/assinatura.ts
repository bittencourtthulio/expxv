// Verificação de assinatura Ed25519 DESTACADA do manifesto (Fase 21, T-21.13, D-343). Chave pública pinada no build (atual + próxima).
// A assinatura é conferida sobre os BYTES ORIGINAIS recebidos, antes de qualquer interpretação do conteúdo.
import { createPublicKey, verify, type KeyObject } from "node:crypto";

export type ResultadoAssinatura =
  | { ok: true; chave: string }
  | { ok: false; motivo: "assinatura_ausente" | "assinatura_invalida" | "chave_revogada" };

const PREFIXO_SPKI = Buffer.from("302a300506032b6570032100", "hex");
const CHAVE_B64 = /^[A-Za-z0-9+/]{43}=$/;

export function chavePublicaDeBase64(b64: string): KeyObject | null {
  if (!CHAVE_B64.test(b64)) return null;
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) return null;
  try {
    return createPublicKey({ key: Buffer.concat([PREFIXO_SPKI, raw]), format: "der", type: "spki" });
  } catch {
    return null;
  }
}

/** Decodifica a assinatura (base64 de exatamente 64 bytes; aceita espaços/quebra de linha finais). */
export function lerAssinatura(texto: string | Uint8Array | null | undefined): Buffer | null {
  if (texto === null || texto === undefined) return null;
  const t = (typeof texto === "string" ? texto : Buffer.from(texto).toString("utf8")).trim();
  if (t.length === 0 || t.length > 200 || !/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return null;
  const b = Buffer.from(t, "base64");
  return b.length === 64 ? b : null;
}

/**
 * @param bytes bytes originais do manifesto
 * @param assinatura assinatura destacada em base64
 * @param chavesAceitas chaves públicas pinadas no build (até 2: atual e próxima, rotação)
 * @param revogadas chaves já revogadas (persistidas localmente): recusadas mesmo se aceitas pelo build
 */
export function verificarAssinatura(bytes: Uint8Array, assinatura: string | Uint8Array | null | undefined, chavesAceitas: readonly string[], revogadas: readonly string[] = []): ResultadoAssinatura {
  const sig = lerAssinatura(assinatura);
  if (sig === null) return { ok: false, motivo: assinatura === null || assinatura === undefined || String(assinatura).trim() === "" ? "assinatura_ausente" : "assinatura_invalida" };
  let revogadaCasou = false;
  for (const b64 of chavesAceitas) {
    const k = chavePublicaDeBase64(b64);
    if (k === null) continue;
    let valida = false;
    try {
      valida = verify(null, bytes, k, sig);
    } catch {
      valida = false;
    }
    if (!valida) continue;
    if (revogadas.includes(b64)) {
      revogadaCasou = true;
      continue;
    }
    return { ok: true, chave: b64 };
  }
  return { ok: false, motivo: revogadaCasou ? "chave_revogada" : "assinatura_invalida" };
}
