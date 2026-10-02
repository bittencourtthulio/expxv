// Integridade e assinatura (Fase 7B, T-07B.09): hash em stream (sha512 npm no formato `sha512-<base64>`,
// sha256 hex), comparação em tempo constante e verificação ECDSA P-256 da assinatura do registro npm sobre
// `"<pacote>@<versao>:<integridade>"`. Chave expirada é recusada. Puro: nada de rede (as chaves vêm do chamador).

import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { createReadStream } from "node:fs";

export type CodigoIntegridade = "integridade_divergente" | "assinatura_invalida" | "chave_desconhecida" | "chave_expirada" | "assinatura_ausente" | "lock_divergente";

export class ErroIntegridade extends Error {
  readonly codigo: CodigoIntegridade;
  constructor(codigo: CodigoIntegridade, mensagem: string = codigo) {
    super(mensagem);
    this.name = "ErroIntegridade";
    this.codigo = codigo;
  }
}

export function integridadeSha512(dados: Buffer | Uint8Array | string): string {
  return `sha512-${createHash("sha512").update(dados).digest("base64")}`;
}
export function sha256Hex(dados: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(dados).digest("hex");
}

export function hashDeArquivo(caminho: string, algoritmo: "sha256" | "sha512"): Promise<string> {
  return new Promise((ok, falha) => {
    const h = createHash(algoritmo);
    createReadStream(caminho).on("data", (c) => h.update(c)).on("error", falha).on("end", () => ok(algoritmo === "sha512" ? `sha512-${h.digest("base64")}` : h.digest("hex")));
  });
}

export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase());
  const y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `esperado` pode ser `sha512-…` (npm) ou `sha256:<hex>`/hex puro. Lança `integridade_divergente`. */
export function conferirIntegridade(dados: Buffer | Uint8Array, esperado: string): void {
  const ok = esperado.startsWith("sha512-") ? iguaisEmTempoConstante(integridadeSha512(dados), esperado)
    : iguaisEmTempoConstante(sha256Hex(dados), esperado.replace(/^sha256:/i, ""));
  if (!ok) throw new ErroIntegridade("integridade_divergente");
}

export function conferirLock(conteudo: Buffer | string, lockSha256: string): void {
  if (!iguaisEmTempoConstante(sha256Hex(conteudo), lockSha256.replace(/^sha256:/i, ""))) throw new ErroIntegridade("lock_divergente");
}

export interface ChaveRegistroNpm { keyid: string; /** base64 DER (SPKI) */ key: string; /** ISO ou null */ expires: string | null }
export interface AssinaturaNpm { keyid: string; sig: string }

export function verificarAssinaturaNpm(p: { pacote: string; versao: string; integridade: string; assinaturas: readonly AssinaturaNpm[]; chaves: readonly ChaveRegistroNpm[]; agora?: Date }): void {
  if (p.assinaturas.length === 0) throw new ErroIntegridade("assinatura_ausente");
  const agora = p.agora ?? new Date();
  const mensagem = Buffer.from(`${p.pacote}@${p.versao}:${p.integridade}`);
  let motivo: CodigoIntegridade = "chave_desconhecida";
  for (const a of p.assinaturas) {
    const chave = p.chaves.find((c) => c.keyid === a.keyid);
    if (!chave) continue;
    if (chave.expires !== null && new Date(chave.expires).getTime() <= agora.getTime()) { motivo = "chave_expirada"; continue; }
    try {
      const publica = createPublicKey({ key: Buffer.from(chave.key, "base64"), format: "der", type: "spki" });
      if (verify("sha256", mensagem, publica, Buffer.from(a.sig, "base64"))) return;
      motivo = "assinatura_invalida";
    } catch { motivo = "assinatura_invalida"; }
  }
  throw new ErroIntegridade(motivo);
}
