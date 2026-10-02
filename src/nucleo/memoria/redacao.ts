// Redação de segredos (T-08.02, D-50). Componente REUTILIZÁVEL: memória, catálogo e RAG (Fase 15) passam TODO texto indexado por aqui.
// Regras de desempenho: todos os padrões têm quantificadores limitados (ou classes simples e gulosas, sem alternância aninhada),
// logo o tempo é linear. O padrão "NOME=valor" é feito à mão (varredura de palavras-chave + expansão limitada) para não ter
// backtracking. Idempotente: redigir duas vezes = redigir uma. Integra o scrubber do cofre (valores conhecidos) quando fornecido.
import type { Scrubber } from "../cofre/scrubber";

export const MARCA_REDIGIDO = "[REDACTED]";

export interface ResultadoRedacao {
  texto: string;
  redigido: boolean;
  substituicoes: number;
}

export interface OpcoesRedacao {
  /** scrubber do cofre: remove os valores LITERAIS de segredos conhecidos (e variantes) antes dos padrões. */
  scrubber?: Pick<Scrubber, "scrub">;
}

const PEM = /-----BEGIN [A-Z ]{0,40}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)/g;
const PADROES_SIMPLES: Array<{ re: RegExp; sub: string }> = [
  { re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g, sub: MARCA_REDIGIDO },
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, sub: MARCA_REDIGIDO },
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g, sub: MARCA_REDIGIDO },
  { re: /\bgithub_pat_[A-Za-z0-9_]{22,}/g, sub: MARCA_REDIGIDO },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, sub: MARCA_REDIGIDO },
  { re: /\bAIza[0-9A-Za-z_-]{35}/g, sub: MARCA_REDIGIDO },
  { re: /\bBearer[ \t]+[A-Za-z0-9._~+/=-]{16,}/gi, sub: `Bearer ${MARCA_REDIGIDO}` },
  { re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, sub: MARCA_REDIGIDO },
];
// scheme://usuario:senha@host  (inclui postgres/mysql/mongodb/redis); mantém scheme e usuário, mascara a senha.
const URL_CRED = /\b([a-z][a-z0-9+.-]{1,20}:\/\/)([^\s:/@]{0,100}):([^\s@/]{1,200})@/gi;
const PALAVRA_CHAVE = /authorization|credential|passwd|password|secret|senha|token|auth|key/gi;
const CHAR_NOME = /[A-Za-z0-9_.-]/;
const EH_MINUSCULA = (c: string): boolean => c >= "a" && c <= "z";
const EH_MAIUSCULA = (c: string): boolean => c >= "A" && c <= "Z";
const CORRIDA_ALNUM = /[A-Za-z0-9]{32,}/g;
const CORRIDA_BASE64 = /[A-Za-z0-9+/]{40,}={0,2}/g;
const HEX_PURO = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

const CONTAGEM = new Int32Array(128);
/** Entropia de Shannon (bits/caractere). Só ASCII entra nos padrões; o resto conta como 1 símbolo à parte. */
function entropia(s: string): number {
  CONTAGEM.fill(0);
  let outros = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) CONTAGEM[c] = (CONTAGEM[c] as number) + 1;
    else outros++;
  }
  let h = 0;
  const f = (n: number): void => {
    if (n === 0) return;
    const p = n / s.length;
    h -= p * Math.log2(p);
  };
  for (let c = 0; c < 128; c++) f(CONTAGEM[c] as number);
  f(outros);
  return h;
}

const temMaiuscula = (s: string): boolean => /[A-Z]/.test(s);
const temMinuscula = (s: string): boolean => /[a-z]/.test(s);
const temDigito = (s: string): boolean => /[0-9]/.test(s);

function pareceSegredoAlnum(s: string, limite: number): boolean {
  if (HEX_PURO.test(s)) return false;
  return temMaiuscula(s) && temMinuscula(s) && temDigito(s) && entropia(s) >= limite;
}

/** `NOME=valor` / `NOME: valor` / `NOME="valor"` com NOME contendo uma palavra-chave de segredo. Varredura linear. */
function redigirPares(texto: string): { texto: string; n: number } {
  if (texto.length < 4) return { texto, n: 0 };
  const saida: string[] = [];
  let pos = 0;
  let n = 0;
  PALAVRA_CHAVE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PALAVRA_CHAVE.exec(texto)) !== null) {
    const k = m.index;
    if (k < pos) continue;
    const fimK = k + m[0].length;
    // fronteira esquerda: "monkey" (minúscula antes de palavra minúscula) não conta; "apiKey" e "APIKEY" contam
    const antes = k > 0 ? (texto[k - 1] as string) : "";
    const inicial = m[0].charAt(0);
    if (antes !== "" && EH_MINUSCULA(antes) && EH_MINUSCULA(inicial)) continue;
    // fronteira direita: "author", "tokens", "keyboard" não contam (minúscula logo depois), "secretKey" conta
    const depois = fimK < texto.length ? (texto[fimK] as string) : "";
    if (depois !== "" && EH_MINUSCULA(depois)) {
      if (!(m[0].toLowerCase() === "authorization" || EH_MAIUSCULA(inicial))) {
        PALAVRA_CHAVE.lastIndex = k + 1;
        continue;
      }
    }
    // nome completo: expande à esquerda e à direita (≤ 40 caracteres cada lado)
    let ini = k;
    while (ini > pos && k - ini < 40 && CHAR_NOME.test(texto[ini - 1] as string)) ini--;
    let fim = fimK;
    while (fim < texto.length && fim - fimK < 40 && CHAR_NOME.test(texto[fim] as string)) fim++;
    let i = fim;
    if (texto[i] === '"' || texto[i] === "'") i++; // JSON: "api_key": "valor"
    const base = i;
    while (i < texto.length && (texto[i] === " " || texto[i] === "\t") && i - base < 4) i++;
    const sep = texto[i];
    if (sep !== "=" && sep !== ":") continue;
    i++;
    while (i < texto.length && (texto[i] === " " || texto[i] === "\t") && i < fim + 12) i++;
    let aspas = "";
    if (texto[i] === '"' || texto[i] === "'") {
      aspas = texto[i] as string;
      i++;
    }
    let iniValor = i;
    const fimValor = (de: number): number => {
      let j = de;
      while (j < texto.length) {
        const c = texto[j] as string;
        if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === '"' || c === "'" || c === "," || c === ";") break;
        j++;
      }
      return j;
    };
    i = fimValor(i);
    let valor = texto.slice(iniValor, i);
    // "Authorization: Bearer <valor>": o segredo é o que vem depois do esquema
    if (valor.length >= 5 && valor.length <= 6 && texto[i] === " " && /^(?:bearer|basic|digest)$/i.test(valor)) {
      iniValor = i + 1;
      i = fimValor(iniValor);
      valor = texto.slice(iniValor, i);
    }
    PALAVRA_CHAVE.lastIndex = Math.max(i, k + 1);
    if (valor.length === 0 || valor.startsWith(MARCA_REDIGIDO)) continue;
    const c0 = valor.charAt(0);
    if ((c0 === "<" || c0 === "$" || c0 === "{" || c0 === "*") && /^(?:<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|\*+)$/.test(valor)) continue; // placeholder óbvio
    saida.push(texto.slice(pos, iniValor), MARCA_REDIGIDO);
    pos = i;
    n++;
    void aspas;
  }
  if (n === 0) return { texto, n: 0 };
  saida.push(texto.slice(pos));
  return { texto: saida.join(""), n };
}

function substituirContando(texto: string, re: RegExp, sub: string | ((...a: string[]) => string)): { texto: string; n: number } {
  let n = 0;
  const t = texto.replace(re, (...args: unknown[]) => {
    n++;
    return typeof sub === "string" ? sub : sub(...(args as string[]));
  });
  return { texto: t, n };
}

/** Redige segredos de `texto`. Seguro para texto de qualquer tamanho (tempo linear). */
export function redigirTexto(texto: string, opcoes: OpcoesRedacao = {}): ResultadoRedacao {
  let t = texto;
  let total = 0;
  if (opcoes.scrubber) {
    const antes = t;
    t = opcoes.scrubber.scrub(t);
    if (t !== antes) total++;
  }
  if (t.length === 0) return { texto: t, redigido: total > 0, substituicoes: total };
  if (t.includes("-----BEGIN")) {
    const r = substituirContando(t, PEM, MARCA_REDIGIDO);
    t = r.texto;
    total += r.n;
  }
  for (const { re, sub } of PADROES_SIMPLES) {
    const r = substituirContando(t, re, sub);
    t = r.texto;
    total += r.n;
  }
  if (t.includes("://")) {
    const r = substituirContando(t, URL_CRED, (_m, esquema, usuario) => `${esquema}${usuario}:${MARCA_REDIGIDO}@`);
    t = r.texto;
    total += r.n;
  }
  const pares = redigirPares(t);
  t = pares.texto;
  total += pares.n;
  if (t.length >= 32) {
    let r = substituirContando(t, CORRIDA_ALNUM, (corrida) => (pareceSegredoAlnum(corrida, 4.0) ? MARCA_REDIGIDO : corrida));
    // contagem: só conta quando trocou de fato
    const trocas = (r.texto.match(/\[REDACTED\]/g) ?? []).length - (t.match(/\[REDACTED\]/g) ?? []).length;
    t = r.texto;
    total += Math.max(0, trocas);
    if (t.includes("+") || t.includes("=")) {
      r = substituirContando(t, CORRIDA_BASE64, (corrida) => {
        const nucleo = corrida.replace(/=+$/, "");
        const ehBase64 = corrida.endsWith("=") || nucleo.includes("+");
        return ehBase64 && pareceSegredoAlnum(nucleo.replace(/[+/]/g, ""), 4.3) ? MARCA_REDIGIDO : corrida;
      });
      const t2 = (r.texto.match(/\[REDACTED\]/g) ?? []).length - (t.match(/\[REDACTED\]/g) ?? []).length;
      t = r.texto;
      total += Math.max(0, t2);
    }
  }
  return { texto: t, redigido: total > 0, substituicoes: total };
}

/** Atalho que devolve só o texto. */
export const redigir = (texto: string, opcoes?: OpcoesRedacao): string => redigirTexto(texto, opcoes).texto;
