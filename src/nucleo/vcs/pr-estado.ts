import { join } from "node:path";
import { lerArquivoSeguro } from "./arquivo-seguro";

// PR da entrega: o que a mergex gravou em `docs/entregas/<trabalho>/ENTREGA.md` (`pr:`) comparado ao que o forge diz (T-06.35).
// SOMENTE LEITURA (D-04): quando disco e forge divergem, o disco é SINALIZADO como desatualizado, nunca reescrito.

import type { PrDaEntrega } from "./pr-sinaleira";
export type { PrDaEntrega } from "./pr-sinaleira";

const ID_TRABALHO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const limpar = (v: string): string => v.trim().replace(/^["']|["']$/g, "").trim();

function estadoDe(v: string | undefined): PrDaEntrega["estado"] {
  const t = (v ?? "").toLowerCase();
  if (/^(aberto|open|opened)$/.test(t)) return "aberto";
  if (/^(fechado|closed)$/.test(t)) return "fechado";
  if (/^(mesclado|merged|mergeado)$/.test(t)) return "mesclado";
  return null;
}

function numeroDe(v: string): number | null {
  const m = /(?:\/pull\/|\/pull-requests\/|\/pullrequest\/|#)?(\d{1,9})\/?$/.exec(limpar(v));
  const n = m === null ? NaN : Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function parsePrDaEntrega(md: string): PrDaEntrega | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (m === null) return null;
  const linhas = (m[1] as string).split(/\r?\n/);
  const i = linhas.findIndex((l) => /^pr\s*:/.test(l));
  if (i < 0) return null;
  const resto = (linhas[i] as string).replace(/^pr\s*:/, "").trim();
  if (resto !== "" && !resto.startsWith("{")) {
    const n = numeroDe(resto);
    return n === null ? null : { numero: n, estado: null };
  }
  const campos: Record<string, string> = {};
  const partes: string[] = [];
  if (resto.startsWith("{")) partes.push(...resto.replace(/^\{|\}$/g, "").split(","));
  else for (const l of linhas.slice(i + 1)) {
    if (/^\S/.test(l)) break;
    partes.push(l);
  }
  for (const p of partes) {
    const kv = /^\s*([A-Za-z_]+)\s*:\s*(.*)$/.exec(p);
    if (kv) campos[(kv[1] as string).toLowerCase()] = limpar(kv[2] as string);
  }
  const n = numeroDe(campos["numero"] ?? campos["number"] ?? campos["url"] ?? "");
  return n === null ? null : { numero: n, estado: estadoDe(campos["estado"] ?? campos["state"]) };
}

export async function lerPrDaEntrega(raizWorkspace: string, trabalhoId: string): Promise<PrDaEntrega | null> {
  if (!ID_TRABALHO.test(trabalhoId)) return null;
  const md = await lerArquivoSeguro(join(raizWorkspace, "docs", "entregas", trabalhoId, "ENTREGA.md"));
  return md === null ? null : parsePrDaEntrega(md);
}
