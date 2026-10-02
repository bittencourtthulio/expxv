// Saneamento de dado de terceiro que atravessa o gateway: nomes pelo alfabeto do protocolo, descrição como TEXTO (sem controle, ANSI, bidi, zero-width,
// markup) e esquema com teto de tamanho. Descrição de servidor é DADO: é cortada, nunca promovida a instrução do Pane.

const CONTROLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;
const BIDI = /[​-‏‪-‮⁦-⁩﻿]/g;
const TAGS = /<\/?[a-zA-Z][^>]{0,200}>/g;

export function sanearTexto(valor: unknown, max: number): string {
  if (typeof valor !== "string") return "";
  const limpo = valor.replace(ANSI, "").replace(CONTROLE, " ").replace(BIDI, "").replace(TAGS, " ").replace(/\s+/g, " ").trim();
  const pontos = [...limpo];
  return pontos.length <= max ? limpo : `${pontos.slice(0, Math.max(0, max - 1)).join("")}…`;
}

/** Nome de tool aceito de um servidor de terceiro (`[A-Za-z0-9_.-]`, 1..128); senão `null` (a ferramenta é descartada). */
export function nomeValidoDeFerramenta(nome: unknown): string | null {
  return typeof nome === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(nome) ? nome : null;
}

const RE_ID_SERVIDOR = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const idDeServidorValido = (id: unknown): id is string => typeof id === "string" && RE_ID_SERVIDOR.test(id);

/** `<servidor com _>__<ferramenta com chars fora do alfabeto → _>` ≤ 64; excesso vira prefixo + hash curto (estável). */
export function nomeExposto(servidorId: string, ferramenta: string, hash: (s: string) => string): string {
  const bruto = `${servidorId.replace(/-/g, "_")}__${ferramenta.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  if (bruto.length <= 64) return bruto;
  return `${bruto.slice(0, 55)}_${hash(bruto).slice(0, 8)}`;
}

/** Esquema JSON de terceiro: precisa ser objeto `type:"object"` e caber em `maxBytes` (senão, esquema aberto mínimo). */
export function sanearEsquema(esquema: unknown, maxBytes = 8 * 1024): Record<string, unknown> {
  const aberto = { type: "object", properties: {}, additionalProperties: true };
  if (typeof esquema !== "object" || esquema === null || Array.isArray(esquema)) return aberto;
  try {
    const txt = JSON.stringify(esquema);
    if (txt === undefined || Buffer.byteLength(txt) > maxBytes) return aberto;
    const o = JSON.parse(txt) as Record<string, unknown>;
    return o["type"] === "object" ? o : aberto;
  } catch {
    return aberto;
  }
}
