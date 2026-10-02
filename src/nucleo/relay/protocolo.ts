// Protocolo do relay `<id>-relay.1` (T-22.06). PURO e compartilhado entre o relay (VPS do dono) e o cliente do host: tipos de controle, parser ESTRITO que nunca lança, e a prova de posse
// (ECDSA P-256 sobre `desafio‖nonce‖canal‖papel‖…`). Só `node:crypto`. Nada de `net`/`http` aqui. O relay NUNCA interpreta o que passa depois do `ok`: são bytes opacos.
//
//   cliente → relay   {"t":"hello","v":"<id>-relay.1","papel":"host"|"cliente","canal":"<32 hex>","ts":<ms>,"nonce":"<b64 16>"}
//   relay → cliente   {"t":"desafio","n":"<b64 16>"}
//   cliente → relay   {"t":"prova","pub":"<b64 SPKI>","sig":"<b64 64>"[, "cli":"<b64 SPKI>", "ef":1]}      (`cli` e `ef` só no host)
//   relay → cliente   {"t":"ok"}  |  {"t":"erro","c":"recusado"|"limite"}                                (códigos UNIFORMES: nunca diz o motivo)
//   depois do ok      quadros binários opacos; `{"t":"ping"}` → `{"t":"pong"}`; host: `{"t":"desregistrar"}`; qualquer um: `{"t":"fechar"}`
import { createHash, createPublicKey, sign as assinarEcdsa, verify as verificarEcdsa } from "node:crypto";
import { LIMITES_RELAY, VERSAO_PROTOCOLO_RELAY } from "../../compartilhado/relay";

export { LIMITES_RELAY, VERSAO_PROTOCOLO_RELAY };
export type Papel = "host" | "cliente";
export type CodigoErroRelay = "recusado" | "limite";

export interface Hello {
  t: "hello";
  v: string;
  papel: Papel;
  canal: string;
  ts: number;
  nonce: string;
}
export interface Desafio {
  t: "desafio";
  n: string;
}
export interface Prova {
  t: "prova";
  pub: string;
  sig: string;
  cli?: string;
  ef?: 1;
}
export type Controle = Hello | Desafio | Prova | { t: "ok" } | { t: "erro"; c: CodigoErroRelay } | { t: "ping" } | { t: "pong" } | { t: "fechar" } | { t: "desregistrar" };

export const CANAL_HEX = /^[0-9a-f]{32}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
export const b64 = (b: Uint8Array): string => Buffer.from(b).toString("base64");
/** Decodifica base64 estrito com tamanho em bytes dentro de [min, max]; `null` se inválido. */
export function deB64(s: unknown, min: number, max: number): Buffer | null {
  if (typeof s !== "string" || s.length === 0 || s.length > Math.ceil(max / 3) * 4 + 4 || s.length % 4 !== 0 || !B64.test(s)) return null;
  const b = Buffer.from(s, "base64");
  return b.length >= min && b.length <= max && b.toString("base64") === s ? b : null;
}
export const SPKI_MAX = 120;
export const SPKI_MIN = 80;

const ok = <T extends Controle>(x: T): T => x;
/** Parser estrito do quadro de controle. NUNCA lança. `limite` = teto em bytes (1 KiB antes da autenticação). Campos extras ou tipos errados ⇒ `null`. */
export function parseControle(texto: unknown, limite: number = LIMITES_RELAY.quadro_pre_auth): Controle | null {
  if (typeof texto !== "string" || texto.length === 0 || Buffer.byteLength(texto) > limite) return null;
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof j !== "object" || j === null || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  const chaves = Object.keys(o).sort().join(",");
  switch (o["t"]) {
    case "hello":
      if (chaves !== "canal,nonce,papel,t,ts,v") return null;
      if (o["v"] !== VERSAO_PROTOCOLO_RELAY || (o["papel"] !== "host" && o["papel"] !== "cliente") || typeof o["canal"] !== "string" || !CANAL_HEX.test(o["canal"])) return null;
      if (typeof o["ts"] !== "number" || !Number.isSafeInteger(o["ts"]) || deB64(o["nonce"], 16, 16) === null) return null;
      return ok({ t: "hello", v: o["v"], papel: o["papel"], canal: o["canal"], ts: o["ts"], nonce: o["nonce"] as string });
    case "desafio":
      if (chaves !== "n,t" || deB64(o["n"], 16, 16) === null) return null;
      return ok({ t: "desafio", n: o["n"] as string });
    case "prova": {
      if (!["pub,sig,t", "cli,ef,pub,sig,t", "cli,pub,sig,t", "ef,pub,sig,t"].includes(chaves)) return null;
      if (deB64(o["pub"], SPKI_MIN, SPKI_MAX) === null || deB64(o["sig"], 64, 64) === null) return null;
      if ("cli" in o && deB64(o["cli"], SPKI_MIN, SPKI_MAX) === null) return null;
      if ("ef" in o && o["ef"] !== 1) return null;
      return ok({ t: "prova", pub: o["pub"] as string, sig: o["sig"] as string, ...("cli" in o ? { cli: o["cli"] as string } : {}), ...("ef" in o ? { ef: 1 as const } : {}) });
    }
    case "ok":
    case "ping":
    case "pong":
    case "fechar":
    case "desregistrar":
      return chaves === "t" ? ok({ t: o["t"] } as Controle) : null;
    case "erro":
      return chaves === "c,t" && (o["c"] === "recusado" || o["c"] === "limite") ? ok({ t: "erro", c: o["c"] }) : null;
    default:
      return null;
  }
}
export const serializar = (c: Controle): string => JSON.stringify(c);
export const ERRO_RECUSADO = serializar({ t: "erro", c: "recusado" });
export const ERRO_LIMITE = serializar({ t: "erro", c: "limite" });

// ---------------------------------------------------------------------------------------------- prova de posse
const lp = (...partes: Array<Uint8Array | string>): Buffer => {
  const bufs = partes.map((p) => (typeof p === "string" ? Buffer.from(p, "utf8") : Buffer.from(p)));
  return Buffer.concat(bufs.flatMap((b) => [Buffer.from([(b.length >>> 24) & 255, (b.length >>> 16) & 255, (b.length >>> 8) & 255, b.length & 255]), b]));
};
export const sha256 = (...p: Array<Uint8Array | string>): Buffer => createHash("sha256").update(lp(...p)).digest();
export interface ParamsProva {
  desafio: Buffer;
  nonceCliente: Buffer;
  canal: string;
  papel: Papel;
  /** só no host: SPKI do dispositivo que poderá ocupar o slot do cliente (ou vazio no canal de pareamento). */
  cli?: Buffer | undefined;
  efemero?: boolean | undefined;
}
export const dadosProva = (p: ParamsProva): Buffer => lp("relay-prova-v1", p.desafio, p.nonceCliente, p.canal, p.papel, p.cli === undefined ? "" : sha256(p.cli), p.efemero === true ? "ef" : "");
export function assinarProva(privadaPkcs8: Buffer, p: ParamsProva): Buffer {
  return assinarEcdsa("sha256", dadosProva(p), { key: Buffer.from(privadaPkcs8), format: "der", type: "pkcs8", dsaEncoding: "ieee-p1363" });
}
export function verificarProva(publicaSpki: Buffer, p: ParamsProva, assinatura: Buffer): boolean {
  try {
    const k = createPublicKey({ key: Buffer.from(publicaSpki), format: "der", type: "spki" });
    if (k.asymmetricKeyType !== "ec" || k.asymmetricKeyDetails?.namedCurve !== "prime256v1") return false;
    return verificarEcdsa("sha256", dadosProva(p), { key: k, dsaEncoding: "ieee-p1363" }, assinatura);
  } catch {
    return false;
  }
}
