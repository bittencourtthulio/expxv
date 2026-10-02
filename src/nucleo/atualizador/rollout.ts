// Rollout gradual determinístico (Fase 21, T-21.13, AU-16). O `idInstalacao` (UUID local) NUNCA sai da máquina: só alimenta um HMAC local.
import { createHmac } from "node:crypto";

/** Bucket 0..99, estável para o mesmo (idInstalacao, versão) e imprevisível sem o id. */
export function bucketDeRollout(idInstalacao: string, versao: string): number {
  const h = createHmac("sha256", idInstalacao).update(`rollout:${versao}`).digest();
  return h.readUInt32BE(0) % 100;
}

export function dentroDoRollout(idInstalacao: string, versao: string, staging: number): boolean {
  if (staging >= 100) return true;
  if (staging <= 0) return false;
  return bucketDeRollout(idInstalacao, versao) < staging;
}

/** Gera um UUID v4 a partir de uma fonte de bytes injetada (testável). */
export function gerarIdInstalacao(bytes: (n: number) => Uint8Array): string {
  const b = Buffer.from(bytes(16));
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
