// Saneamento de texto de terceiro (T-07.03): descrição/nome de skill, agente, comando e MCP é DADO. Pura.

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
// CSI (ESC [ ... letra), OSC (ESC ] ... BEL | ESC \) e escapes de 2 caracteres
const ANSI = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|[@-Z\\\\-_])`, "g");
const CONTROLES = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]", "g");
const INVISIVEIS = new RegExp("[\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff\\u2028\\u2029]", "g");

/** Remove ANSI, controles, bidi e zero-width; colapsa espaços; trunca em code points. */
export function sanearTexto(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  const limpo = s.replace(ANSI, "").replace(INVISIVEIS, "").replace(CONTROLES, " ").replace(/\s+/g, " ").trim();
  const pontos = Array.from(limpo);
  return pontos.length <= max ? limpo : pontos.slice(0, max).join("").trimEnd();
}

/** Nome exibível: saneado e curto (nunca vira caminho). */
export function sanearNome(s: unknown): string {
  return sanearTexto(s, 80).replace(/[\\/]/g, "_");
}
