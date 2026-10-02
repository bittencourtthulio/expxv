// Primitivas de segurança da Fase 19 (única porta de entrada de texto para qualquer artefato): redação de segredos (cofre + padrões), caminho absoluto,
// controle, escape de HTML/Markdown e CSV (com proteção contra injeção de fórmula). Tudo puro e determinístico.
import { redigirSegredos } from "../agil/util";

export type Scrub = (texto: string) => string;
export const scrubNulo: Scrub = (t) => t;

// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
const CAMINHOS: RegExp[] = [
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi, // qualquer URL (inclui file://) é tratada abaixo: só http(s) sem credencial sobrevive
  /(?:\b[A-Za-z]:[\\/]|\\\\)[^\s"'<>|]+/g, // C:\Users\x ou \\servidor\pasta
  /(?<![\w.:/@-])\/(?:Users|home|var|private|tmp|etc|opt|root|mnt|Volumes|usr|srv|Library|Applications|System|proc|dev)\/[^\s"'<>|]*/g,
  /(?<![\w.:/@-])~\/[^\s"'<>|]*/g,
];

/** `http(s)://` sem credencial e sem controle (e curta) ou `null`. É a ÚNICA forma de um link entrar num artefato. */
export function urlSegura(u: string | null | undefined): string | null {
  if (typeof u !== "string" || u.length === 0 || u.length > 500) return null;
  if (CONTROLE.test(u)) { CONTROLE.lastIndex = 0; return null; }
  CONTROLE.lastIndex = 0;
  if (/\s/.test(u)) return null;
  try {
    const x = new URL(u);
    if (x.protocol !== "https:" && x.protocol !== "http:") return null;
    if (x.username !== "" || x.password !== "") return null;
    return x.href;
  } catch {
    return null;
  }
}

/** troca caminho absoluto (POSIX, Windows, UNC, `~/`) por `[caminho]` e URL não segura por `[link removido]`; URL http(s) sem credencial é preservada. */
export function semCaminhoAbsoluto(t: string): string {
  let r = t;
  r = r.replace(CAMINHOS[0] as RegExp, (m) => (urlSegura(m.replace(/[).,;]+$/, "")) !== null ? m : "[link removido]"));
  for (const re of CAMINHOS.slice(1)) r = r.replace(re, "[caminho]");
  return r.replace(/\b(?:javascript|vbscript)\s*:\S*/gi, "[link removido]");
}

/** todo texto que entra em fatos/artefatos/prompt passa por aqui: controle fora, cofre, segredos por padrão, caminho absoluto, tamanho. */
export function limparTexto(t: string | null | undefined, scrub: Scrub = scrubNulo, max = 600): string {
  if (t === null || t === undefined) return "";
  let r = String(t).replace(CONTROLE, "").replace(/\r\n?/g, "\n");
  r = scrub(r);
  r = redigirSegredos(r);
  r = semCaminhoAbsoluto(r);
  r = r.replace(/[ \t]+/g, " ").trim();
  return r.length > max ? `${r.slice(0, max - 1).trimEnd()}…` : r;
}
export const limparLinha = (t: string | null | undefined, scrub: Scrub = scrubNulo, max = 200): string => limparTexto(t, scrub, max).replace(/\s*\n\s*/g, " ");

const HTML: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
export const escaparHtml = (t: unknown): string => String(t ?? "").replace(/[&<>"'`]/g, (c) => HTML[c] as string);

/** escapa o que muda o sentido em Markdown/HTML embutido; mantém hífen e ponto no meio da frase. */
export function escaparMd(t: unknown): string {
  return String(t ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/[\\`*_[\]<>|~&]/g, (c) => `\\${c}`)
    .replace(/^(\s*)([#>+-]|\d+[.)])(\s)/, "$1\\$2$3")
    .replace(/^(\s*)(#+)/, "$1\\$2");
}
/** conteúdo de bloco de código em linha seguro (sem crase). */
export const codigoMd = (t: unknown): string => `\`${String(t ?? "").replace(/[`\r\n]/g, "'")}\``;

const GATILHO_FORMULA = /^[\s]*[=+\-@\t\r＝＋－＠]/;
/** RFC 4180 + neutralização de fórmula: célula que COMEÇA (ignorando espaços) com = + - @ tab CR (inclui largura total) ganha `'` à frente. Nunca `0` para vazio. */
export function celulaCsv(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : typeof v === "boolean" ? (v ? "sim" : "nao") : String(v);
  s = s.replace(CONTROLE, "");
  if (typeof v !== "number" && GATILHO_FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function csvDe(colunas: readonly string[], linhas: readonly Record<string, unknown>[], opcoes: { bom?: boolean } = {}): string {
  const corpo = [colunas.map(celulaCsv).join(","), ...linhas.map((l) => colunas.map((c) => celulaCsv(l[c])).join(","))].join("\r\n");
  return `${opcoes.bom === true ? "\uFEFF" : ""}${corpo}\r\n`;
}

/** segmento seguro de nome de arquivo/pasta: só [A-Za-z0-9._-], sem `..`, sem ponto inicial. */
export const nomeSeguroArquivo = (n: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(n) && !n.includes("..");
/** nome de arquivo de pacote: um segmento, ou `divulgacao/<segmento>`. */
export const nomeDePacoteValido = (n: string): boolean => {
  const partes = n.split("/");
  return (partes.length === 1 || (partes.length === 2 && partes[0] === "divulgacao")) && partes.every(nomeSeguroArquivo);
};
