// Ids determinísticos (G §7): UUIDv5 sobre sha256 do escopo/tipo/origem/índice/texto. Idêntico em qualquer máquina.
import { createHash } from "node:crypto";

/** Namespace fixo do app (UUID escolhido uma vez; nunca mudar: quebraria a deduplicação entre máquinas). */
export const NS_APP = "6f1d2c34-5a7b-4e08-9c3d-2b8e41a7d9f0";

export function uuid5(nome: string, namespace: string = NS_APP): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(ns).update(nome, "utf8").digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = ((b[6] as number) & 0x0f) | 0x50;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const sha256 = (t: string): string => createHash("sha256").update(t, "utf8").digest("hex");

/** Texto normalizado para identidade: LF, sem espaço final. */
export const normalizarIdentidade = (t: string): string => t.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();

export function idChunk(p: { escopo: string; tipo: string; origem: string; indice: number; texto: string }): string {
  return uuid5(sha256(`${p.escopo}\n${p.tipo}\n${p.origem}\n${p.indice}\n${sha256(normalizarIdentidade(p.texto))}`));
}

export function idDocumento(p: { escopo: string; tipo: string; origem: string }): string {
  return uuid5(sha256(`${p.escopo}\ndoc\n${p.tipo}\n${p.origem}`));
}

let seq = 0;
/** `<prefixo>_<ulid-like>`: tempo + contador + aleatório curto (ordenável; id local, não compartilhado). */
export function idLocal(prefixo: string, ms: number = Date.now()): string {
  seq = (seq + 1) % 1_679_616;
  const rnd = createHash("sha1").update(`${ms}:${seq}:${Math.random()}`).digest("hex").slice(0, 6);
  return `${prefixo}_${ms.toString(36).padStart(9, "0")}${seq.toString(36).padStart(4, "0")}${rnd}`;
}
