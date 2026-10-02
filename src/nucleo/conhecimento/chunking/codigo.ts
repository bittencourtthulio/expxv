// Chunking de código por SÍMBOLO (regex por linguagem; sem tree-sitter): cabeçalho `arquivo › símbolo`; sem símbolo, janelas de
// 60 linhas. Determinístico; redação antes de chunkar; nunca perde linha (a concatenação dos corpos cobre o texto redigido).
import { janelas, montar, redigir, type ChunkPronto, type OpcoesChunking } from "./comum";

const JANELA_LINHAS = 60;
const CORPO_MAX = 1700;

type Regra = { re: RegExp; nome: (m: RegExpExecArray) => string };
const g = (i: number) => (m: RegExpExecArray): string => (m[i] as string) ?? "";

const TS: Regra[] = [
  { re: /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|enum)\s+([A-Za-z_$][\w$]*)/, nome: g(1) },
  { re: /^(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*[<=]/, nome: g(1) },
  { re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/, nome: g(1) },
  { re: /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*[:=]/, nome: g(1) },
];
const PY: Regra[] = [
  { re: /^(?:async\s+)?def\s+([A-Za-z_]\w*)/, nome: g(1) },
  { re: /^class\s+([A-Za-z_]\w*)/, nome: g(1) },
];
const GO: Regra[] = [
  { re: /^func\s+(?:\(\s*\w+\s+\*?(\w+)[^)]*\)\s*)?([A-Za-z_]\w*)/, nome: (m) => (m[1] ? `${m[1]}.${m[2] as string}` : (m[2] as string)) },
  { re: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/, nome: g(1) },
];
const RUST: Regra[] = [{ re: /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|unsafe\s+|const\s+)*(?:fn|struct|enum|trait|mod|impl)\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*)/, nome: g(1) }];
const JAVA: Regra[] = [{ re: /^\s{0,4}(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial|open|data)\s+)*(?:class|interface|enum|record|struct)\s+([A-Za-z_]\w*)/, nome: g(1) }];
const PHP: Regra[] = [{ re: /^\s{0,4}(?:(?:abstract|final)\s+)?(?:class|interface|trait|function)\s+([A-Za-z_]\w*)/, nome: g(1) }];
const RUBY: Regra[] = [{ re: /^\s{0,2}(?:def|class|module)\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/, nome: g(1) }];

const POR_EXTENSAO: Record<string, Regra[]> = {
  ts: TS, tsx: TS, js: TS, jsx: TS, mjs: TS, cjs: TS, mts: TS,
  py: PY, go: GO, rs: RUST, java: JAVA, kt: JAVA, cs: JAVA, php: PHP, rb: RUBY,
};

export const linguagensSuportadas = (): string[] => Object.keys(POR_EXTENSAO);

export function extensaoDe(caminho: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(caminho);
  return m ? (m[1] as string).toLowerCase() : "";
}

interface Segmento {
  simbolo: string | null;
  linhas: string[];
}

export function segmentar(linhas: readonly string[], regras: readonly Regra[]): Segmento[] {
  const segs: Segmento[] = [];
  let atual: Segmento = { simbolo: null, linhas: [] };
  for (const l of linhas) {
    let nome: string | null = null;
    if (regras.length > 0 && l.length > 0 && l.length < 400) {
      for (const r of regras) {
        const m = r.re.exec(l);
        if (m) {
          nome = r.nome(m);
          break;
        }
      }
    }
    if (nome !== null) {
      if (atual.linhas.length > 0) segs.push(atual);
      atual = { simbolo: nome, linhas: [l] };
    } else atual.linhas.push(l);
  }
  if (atual.linhas.length > 0) segs.push(atual);
  return segs;
}

export interface EntradaCodigo {
  /** caminho RELATIVO ao workspace. */
  arquivo: string;
  texto: string;
  linguagem?: string;
}

/** Chunks de um arquivo de código. O chamador já recusou caminho proibido, binário e arquivo gigante. */
export function chunksDeCodigo(e: EntradaCodigo, op: OpcoesChunking = {}): ChunkPronto[] {
  const texto = redigir(e.texto.replace(/\r\n?/g, "\n"), op);
  const regras = POR_EXTENSAO[(e.linguagem ?? extensaoDe(e.arquivo)).toLowerCase()] ?? [];
  const linhas = texto.split("\n");
  const itens: Array<{ texto: string; titulos: string }> = [];
  const cab = (s: string | null): string => (s === null ? e.arquivo : `${e.arquivo} › ${s}`);
  const segs = regras.length > 0 ? segmentar(linhas, regras) : [{ simbolo: null, linhas }];
  for (const s of segs) {
    const titulo = cab(s.simbolo);
    const corpoMax = Math.max(200, CORPO_MAX - titulo.length);
    const maxLinhas = s.simbolo === null ? JANELA_LINHAS : 400;
    const partes = janelas(s.linhas, maxLinhas, corpoMax).filter((p) => p.trim() !== "");
    partes.forEach((p, i) => itens.push({ texto: `${titulo}${partes.length > 1 ? ` (parte ${i + 1}/${partes.length})` : ""}\n${p}`, titulos: titulo }));
  }
  return montar(itens);
}

/** Símbolos de topo (nomes únicos, ≤ 200) pela mesma regra do chunker. */
export function simbolosDeCodigo(arquivo: string, texto: string, linguagem?: string): string[] {
  const regras = POR_EXTENSAO[(linguagem ?? extensaoDe(arquivo)).toLowerCase()] ?? [];
  if (regras.length === 0) return [];
  const nomes = segmentar(texto.split("\n"), regras).map((s) => s.simbolo).filter((n): n is string => n !== null && n !== "");
  return [...new Set(nomes)].slice(0, 200);
}
