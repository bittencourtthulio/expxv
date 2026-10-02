import type { Linguagem } from "../tipos";

// Duplicação grosseira (T-17.27, opcional, desligada por padrão em `mapa.duplicacao`): winnowing (Schleimer et al.)
// com k = 25 tokens e janela 4 sobre tokens NORMALIZADOS (identificadores e literais abstraídos). Ignora comentários
// (cabeçalhos de licença inclusive) e linhas de `import`/`using`/`require`/`#include`.

export const K_PADRAO = 25;
export const JANELA_PADRAO = 4;
export const MIN_TOKENS_CLONE = 50;

export interface Token {
  texto: string;
  linha: number;
}

const PALAVRAS = new Set(
  "if else elif for foreach while do switch case default break continue return throw try catch finally except raise class interface struct enum function def fn func fun public private protected static final const let var new this self super async await yield lambda with as in is not and or null nil none true false void int long float double string bool boolean char byte".split(" "),
);

const LINHA_IMPORT = /^\s*(import\b|from\s+\S+\s+import\b|using\s+[\w.]+;|require(_once)?\b|include(_once)?\b|#\s*include\b|use\s+[\w\\]+;|package\b|namespace\b)/;

/** Tokeniza e normaliza: `I` identificador, `S` texto, `N` número; palavras-chave e pontuação ficam. */
export function tokenizar(texto: string, linguagem: Linguagem | string = "typescript"): Token[] {
  const hash = ["python", "ruby", "php"].includes(linguagem);
  const saida: Token[] = [];
  const linhas = texto.split("\n");
  let emBloco = false;
  for (let n = 0; n < linhas.length; n++) {
    let l = linhas[n] as string;
    if (emBloco) {
      const f = l.indexOf("*/");
      if (f < 0) continue;
      l = l.slice(f + 2);
      emBloco = false;
    }
    if (LINHA_IMPORT.test(l)) continue;
    let i = 0;
    while (i < l.length) {
      const c = l[i] as string;
      if (/\s/.test(c)) { i++; continue; }
      if (c === "/" && l[i + 1] === "*") {
        const f = l.indexOf("*/", i + 2);
        if (f < 0) { emBloco = true; break; }
        i = f + 2;
        continue;
      }
      if ((c === "/" && l[i + 1] === "/") || (c === "#" && (hash || linguagem === "ruby")) || (c === "-" && l[i + 1] === "-" && linguagem === "sql")) break;
      if (c === '"' || c === "'" || c === "`") {
        let j = i + 1;
        while (j < l.length && l[j] !== c) j += l[j] === "\\" ? 2 : 1;
        saida.push({ texto: "S", linha: n + 1 });
        i = j + 1;
        continue;
      }
      if (/\d/.test(c)) {
        let j = i + 1;
        while (j < l.length && /[\w.]/.test(l[j] as string)) j++;
        saida.push({ texto: "N", linha: n + 1 });
        i = j;
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        let j = i + 1;
        while (j < l.length && /[\w$]/.test(l[j] as string)) j++;
        const p = l.slice(i, j);
        saida.push({ texto: PALAVRAS.has(p) ? p : "I", linha: n + 1 });
        i = j;
        continue;
      }
      saida.push({ texto: c, linha: n + 1 });
      i++;
    }
  }
  return saida;
}

export interface Impressao {
  hash: number;
  /** Índice do primeiro token do k-grama. */
  pos: number;
  linha: number;
}

function fnv(tokens: readonly Token[], de: number, k: number): number {
  let h = 0x811c9dc5;
  for (let i = de; i < de + k; i++) {
    const t = (tokens[i] as Token).texto;
    for (let c = 0; c < t.length; c++) h = Math.imul(h ^ t.charCodeAt(c), 0x01000193) >>> 0;
    h = Math.imul(h ^ 0x1f, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Winnowing: de cada janela de `w` hashes seleciona o mínimo (o mais à direita em empate). */
export function impressoes(tokens: readonly Token[], k = K_PADRAO, w = JANELA_PADRAO): Impressao[] {
  const n = tokens.length - k + 1;
  if (n <= 0) return [];
  const hs = Array.from({ length: n }, (_, i) => fnv(tokens, i, k));
  const saida: Impressao[] = [];
  let ultimo = -1;
  for (let i = 0; i + w <= n; i++) {
    let m = i;
    for (let j = i; j < i + w; j++) if ((hs[j] as number) <= (hs[m] as number)) m = j;
    if (m !== ultimo) {
      saida.push({ hash: hs[m] as number, pos: m, linha: (tokens[m] as Token).linha });
      ultimo = m;
    }
  }
  if (n < w && n > 0) {
    let m = 0;
    for (let j = 0; j < n; j++) if ((hs[j] as number) <= (hs[m] as number)) m = j;
    saida.push({ hash: hs[m] as number, pos: m, linha: (tokens[m] as Token).linha });
  }
  return saida;
}

export interface ArquivoDuplicacao {
  caminho: string;
  tokens: readonly Token[];
  impressoes: readonly Impressao[];
}

export function prepararDuplicacao(caminho: string, texto: string, linguagem: Linguagem | string): ArquivoDuplicacao {
  const tokens = tokenizar(texto, linguagem);
  return { caminho, tokens, impressoes: impressoes(tokens) };
}

export interface TrechoClone {
  caminho: string;
  linha_ini: number;
  linha_fim: number;
}

export interface ParClone {
  a: TrechoClone;
  b: TrechoClone;
  /** Tokens do trecho (estimativa exata: verificada token a token). */
  tokens: number;
}

export interface ResultadoClones {
  pares: ParClone[];
  /** Classes de clones (conjuntos de trechos equivalentes). */
  classes: TrechoClone[][];
}

/** Confirma e estende o casamento token a token a partir de dois k-gramas com mesmo hash. */
function estender(a: readonly Token[], pa: number, b: readonly Token[], pb: number): { ini: number; fim: number; ib: number } | null {
  let i = 0;
  while (pa - i - 1 >= 0 && pb - i - 1 >= 0 && (a[pa - i - 1] as Token).texto === (b[pb - i - 1] as Token).texto) i++;
  let f = 0;
  while (pa + f < a.length && pb + f < b.length && (a[pa + f] as Token).texto === (b[pb + f] as Token).texto) f++;
  if (f === 0) return null;
  return { ini: pa - i, fim: pa + f, ib: pb - i };
}

export function acharClones(arquivos: readonly ArquivoDuplicacao[], minTokens = MIN_TOKENS_CLONE): ResultadoClones {
  const indice = new Map<number, Array<{ f: number; pos: number }>>();
  arquivos.forEach((a, f) => {
    for (const im of a.impressoes) {
      let l = indice.get(im.hash);
      if (l === undefined) indice.set(im.hash, (l = []));
      l.push({ f, pos: im.pos });
    }
  });
  const vistos = new Set<string>();
  const pares: ParClone[] = [];
  for (const locais of indice.values()) {
    if (locais.length < 2 || locais.length > 50) continue; // hash comum demais = código-padrão
    for (let x = 0; x < locais.length; x++) {
      for (let y = x + 1; y < locais.length; y++) {
        const A = locais[x] as { f: number; pos: number };
        const B = locais[y] as { f: number; pos: number };
        const ta = (arquivos[A.f] as ArquivoDuplicacao).tokens;
        const tb = (arquivos[B.f] as ArquivoDuplicacao).tokens;
        const ext = estender(ta, A.pos, tb, B.pos);
        if (ext === null) continue;
        const tam = ext.fim - ext.ini;
        if (tam < minTokens) continue;
        if (A.f === B.f && Math.abs(ext.ini - ext.ib) < tam) continue; // sobreposição no mesmo arquivo
        const chave = `${Math.min(A.f, B.f)}:${A.f < B.f ? ext.ini : ext.ib}|${Math.max(A.f, B.f)}:${A.f < B.f ? ext.ib : ext.ini}|${tam}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        const ca = arquivos[A.f] as ArquivoDuplicacao;
        const cb = arquivos[B.f] as ArquivoDuplicacao;
        pares.push({
          a: { caminho: ca.caminho, linha_ini: (ta[ext.ini] as Token).linha, linha_fim: (ta[ext.fim - 1] as Token).linha },
          b: { caminho: cb.caminho, linha_ini: (tb[ext.ib] as Token).linha, linha_fim: (tb[ext.ib + tam - 1] as Token).linha },
          tokens: tam,
        });
      }
    }
  }
  // remove pares contidos em outros (mesmos arquivos, intervalos de linha contidos)
  const contido = (p: TrechoClone, q: TrechoClone): boolean => p.caminho === q.caminho && p.linha_ini >= q.linha_ini && p.linha_fim <= q.linha_fim;
  const finais = pares.filter((p, i) => !pares.some((q, j) => j !== i && ((contido(p.a, q.a) && contido(p.b, q.b)) || (contido(p.a, q.b) && contido(p.b, q.a))) && (q.tokens > p.tokens || (q.tokens === p.tokens && j < i))));
  finais.sort((x, y) => y.tokens - x.tokens || x.a.caminho.localeCompare(y.a.caminho) || x.a.linha_ini - y.a.linha_ini);
  // classes por união de trechos
  const pai = new Map<string, string>();
  const chave = (t: TrechoClone): string => `${t.caminho}:${t.linha_ini}-${t.linha_fim}`;
  const raiz = (k: string): string => {
    let r = k;
    while ((pai.get(r) ?? r) !== r) r = pai.get(r) as string;
    pai.set(k, r);
    return r;
  };
  const trechos = new Map<string, TrechoClone>();
  for (const p of finais) {
    for (const t of [p.a, p.b]) {
      trechos.set(chave(t), t);
      if (!pai.has(chave(t))) pai.set(chave(t), chave(t));
    }
    pai.set(raiz(chave(p.a)), raiz(chave(p.b)));
  }
  const grupos = new Map<string, TrechoClone[]>();
  for (const [k, t] of trechos) {
    const r = raiz(k);
    let g = grupos.get(r);
    if (g === undefined) grupos.set(r, (g = []));
    g.push(t);
  }
  const classes = [...grupos.values()].map((g) => g.sort((x, y) => x.caminho.localeCompare(y.caminho) || x.linha_ini - y.linha_ini)).sort((x, y) => y.length - x.length || (x[0] as TrechoClone).caminho.localeCompare((y[0] as TrechoClone).caminho));
  return { pares: finais, classes };
}
