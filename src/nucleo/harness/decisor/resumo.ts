// Resumo REDIGIDO para o decisor externo: é tudo o que sai da máquina (≤ 500 chars). Nunca diff, saída de terminal nem conteúdo de arquivo.
// Remove: blocos de código, URLs, e-mails, valores de arquivo de ambiente (NOME=valor), caminhos absolutos,
// sequências com cara de token (≥ 20 chars, `sk-`, `sk-or-`, `ghp_`, JWT…).
import { createHash } from "node:crypto";

export const RESUMO_MAX = 500;
/** Entrada lida (o resto é ignorado): torna a redação linear mesmo com 100 KB. */
const ENTRADA_MAX = 6000;

const RE_BLOCO = /```[\s\S]*?(?:```|$)/g;
const RE_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi;
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const RE_VARIAVEL = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]{1,63})[ \t]*=[ \t]*\S.*$/gm;
const RE_CAMINHO_WIN = /\b[A-Za-z]:\\[^\s"']+/g;
const RE_CAMINHO = /(?<![\w./:-])(?:~|\.\.?)?\/[\w.@+-]+(?:\/[\w.@+-]+)+\/?/g;
const RE_TOKEN_CONHECIDO = /\b(?:sk-[A-Za-z0-9_-]{6,}|gh[pousr]_[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+){1,2}|AKIA[0-9A-Z]{12,}|xox[abprs]-[A-Za-z0-9-]{8,}|AIza[0-9A-Za-z_-]{20,})/g;
const RE_LONGA = /[A-Za-z0-9_\-+/=]{20,}/g;

export function resumirParaDecisor(texto: string, opcoes: { max?: number; scrub?: (t: string) => string } = {}): string {
  const max = Math.min(opcoes.max ?? RESUMO_MAX, RESUMO_MAX);
  let t = texto.length > ENTRADA_MAX ? texto.slice(0, ENTRADA_MAX).replace(/\S*$/, "") : texto;
  if (opcoes.scrub !== undefined) t = opcoes.scrub(t);
  t = t
    .replace(RE_BLOCO, " [código] ")
    .replace(RE_URL, "[url]")
    .replace(RE_EMAIL, "[email]")
    .replace(RE_VARIAVEL, "$1=[valor]")
    .replace(RE_CAMINHO_WIN, "[caminho]")
    .replace(RE_CAMINHO, "[caminho]")
    .replace(RE_TOKEN_CONHECIDO, "[segredo]")
    .replace(RE_LONGA, "[segredo]")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > max) t = `${t.slice(0, max - 1).replace(/\S*$/, "").trimEnd() || t.slice(0, max - 1)}…`;
  return t.length > max ? t.slice(0, max) : t;
}

export const hashResumo = (resumo: string): string => createHash("sha256").update(resumo, "utf8").digest("hex");
