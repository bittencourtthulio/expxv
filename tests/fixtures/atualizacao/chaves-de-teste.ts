// Chaves Ed25519 SÓ DE TESTE (semente fixa e pública). Nunca são as chaves de release: o perfil `release` as recusa (scripts/lib/distribuicao.mjs).
import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";

const PREFIXO_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const SEMENTES = {
  atual: "expx-chave-de-teste-atual-0001",
  proxima: "expx-chave-de-teste-proxima-001",
  /** uma terceira chave que o build de teste NÃO aceita. */
  intrusa: "expx-chave-de-teste-intrusa-0001",
} as const;
export type NomeChaveDeTeste = keyof typeof SEMENTES;

function privada(nome: NomeChaveDeTeste): KeyObject {
  return createPrivateKey({ key: Buffer.concat([PREFIXO_PKCS8, createHash("sha256").update(SEMENTES[nome]).digest()]), format: "der", type: "pkcs8" });
}
export function publicaDeTeste(nome: NomeChaveDeTeste): string {
  return createPublicKey(privada(nome)).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
}
/** assinatura destacada (base64) dos bytes com a chave de teste escolhida. */
export function assinarComo(nome: NomeChaveDeTeste, bytes: Uint8Array | string): string {
  return sign(null, Buffer.from(bytes), privada(nome)).toString("base64");
}
export const CHAVES_ACEITAS_DE_TESTE = [publicaDeTeste("atual"), publicaDeTeste("proxima")];

/** PEM PKCS#8 da chave de TESTE (para os testes dos scripts de assinatura; nunca uma chave real). */
export function privadaPemDeTeste(nome: NomeChaveDeTeste): string {
  return privada(nome).export({ format: "pem", type: "pkcs8" }).toString();
}
