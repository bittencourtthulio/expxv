// Ingestão reutilizável (T-08.34): normalização, saneamento e chunking PUROS e determinísticos. A Fase 15 (RAG) reutiliza este
// componente: todo texto que vai para índice/FTS/vetor passa por `prepararDocumento` (redação ANTES de chunkar).
import { createHash } from "node:crypto";
import { redigirTexto, type OpcoesRedacao } from "./redacao";

export interface OpcoesChunk {
  alvoChars?: number;
  sobreposicao?: number;
  maxChars?: number;
  respeitarMarkdown?: boolean;
}

export interface Chunk {
  ordem: number;
  texto: string;
  /** deslocamentos no texto NORMALIZADO (fim exclusivo). */
  inicio: number;
  fim: number;
  titulos: string[];
  hash: string;
}

const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g;
const cp = (...n: number[]): string => n.map((c) => String.fromCharCode(c)).join("");
const INVISIVEIS = new RegExp(`[${cp(0x200b)}-${cp(0x200f)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}${cp(0xfeff, 0xad)}]`, "g");
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

export const sha256 = (t: string): string => createHash("sha256").update(t, "utf8").digest("hex");

/** CRLF→LF, remove controles/ANSI/bidi e colapsa espaços, sem tocar em blocos de código (cercas ``` e ~~~). */
export function normalizarParaIndice(texto: string): string {
  const limpo = texto.replace(/\r\n?/g, "\n").replace(ANSI, "").replace(INVISIVEIS, "").replace(CONTROLES, "");
  const linhas = limpo.split("\n");
  let cerca: string | null = null;
  const saida: string[] = [];
  let vazias = 0;
  for (const l of linhas) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (m) {
      const marca = (m[1] as string).charAt(0);
      if (cerca === null) cerca = marca;
      else if (cerca === marca) cerca = null;
      saida.push(l.replace(/[ \t]+$/, ""));
      vazias = 0;
      continue;
    }
    if (cerca !== null) {
      saida.push(l);
      continue;
    }
    const c = l.replace(/[ \t]+$/, "").replace(/(?<=\S)[ \t]{2,}/g, " ");
    if (c === "") {
      vazias++;
      if (vazias > 1) continue;
    } else vazias = 0;
    saida.push(c);
  }
  return saida.join("\n").trim();
}

interface Unidade {
  inicio: number;
  fim: number;
  titulos: string[];
  cerca: boolean;
  secao: number;
}

function unidades(texto: string, markdown: boolean): Unidade[] {
  const us: Unidade[] = [];
  const pilha: Array<{ nivel: number; texto: string }> = [];
  let secao = 0;
  let pos = 0;
  let ini = -1; // início do parágrafo corrente
  let tituloIni: string[] = [];
  let cerca: { marca: string; ini: number; titulos: string[] } | null = null;
  const titulosAtuais = (): string[] => pilha.map((p) => p.texto);
  const fecharParagrafo = (fim: number): void => {
    if (ini >= 0) {
      us.push({ inicio: ini, fim, titulos: tituloIni, cerca: false, secao });
      ini = -1;
    }
  };
  while (pos <= texto.length) {
    let nl = texto.indexOf("\n", pos);
    if (nl < 0) nl = texto.length;
    const linha = texto.slice(pos, nl);
    if (markdown) {
      const mc = /^\s{0,3}(`{3,}|~{3,})/.exec(linha);
      if (cerca) {
        if (mc && (mc[1] as string).charAt(0) === cerca.marca) {
          us.push({ inicio: cerca.ini, fim: nl, titulos: cerca.titulos, cerca: true, secao });
          cerca = null;
        }
        pos = nl + 1;
        continue;
      }
      if (mc) {
        fecharParagrafo(pos > 0 ? pos - 1 : 0);
        cerca = { marca: (mc[1] as string).charAt(0), ini: pos, titulos: titulosAtuais() };
        pos = nl + 1;
        continue;
      }
      const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(linha);
      if (h) {
        fecharParagrafo(pos > 0 ? pos - 1 : 0);
        const nivel = (h[1] as string).length;
        while (pilha.length > 0 && (pilha[pilha.length - 1] as { nivel: number }).nivel >= nivel) pilha.pop();
        pilha.push({ nivel, texto: (h[2] as string).slice(0, 120) });
        secao++;
        // o título faz parte do começo do próximo parágrafo (contexto), mas não vira unidade sozinho
        ini = pos;
        tituloIni = titulosAtuais();
        pos = nl + 1;
        continue;
      }
    }
    if (linha.trim() === "") fecharParagrafo(pos > 0 ? pos - 1 : 0);
    else if (ini < 0) {
      ini = pos;
      tituloIni = titulosAtuais();
    }
    pos = nl + 1;
  }
  if (cerca) us.push({ inicio: cerca.ini, fim: texto.length, titulos: cerca.titulos, cerca: true, secao });
  fecharParagrafo(texto.length);
  return us.filter((u) => u.fim > u.inicio);
}

/** Corta [ini, fim) em pedaços ≤ max, preferindo quebra de linha, depois de frase, depois espaço. */
function cortar(texto: string, ini: number, fim: number, max: number): Array<[number, number]> {
  const partes: Array<[number, number]> = [];
  let a = ini;
  while (fim - a > max) {
    const limite = a + max;
    let b = texto.lastIndexOf("\n", limite);
    if (b <= a + max / 2) {
      const janela = texto.slice(a + Math.floor(max / 2), limite);
      const f = Math.max(janela.lastIndexOf(". "), janela.lastIndexOf("! "), janela.lastIndexOf("? "));
      b = f >= 0 ? a + Math.floor(max / 2) + f + 1 : texto.lastIndexOf(" ", limite);
    }
    if (b <= a) b = limite; // corte duro (palavra gigante)
    else if (b < limite && texto[b] === "\n") b = b; // mantém a quebra no início do próximo
    partes.push([a, b]);
    a = b;
    while (a < fim && (texto[a] === " " || texto[a] === "\n")) a++;
  }
  if (fim > a) partes.push([a, fim]);
  return partes;
}

function bordaDePalavra(texto: string, alvo: number, minimo: number, maximo: number): number {
  let i = Math.max(minimo, Math.min(alvo, maximo));
  while (i < maximo && i > minimo && !/\s/.test(texto.charAt(i - 1))) i++;
  return Math.min(i, maximo);
}

/** Chunks determinísticos de um texto JÁ normalizado: título > parágrafo > frase; nunca no meio de cerca de código se couber em `maxChars`. */
export function dividirEmChunks(texto: string, op: OpcoesChunk = {}): Chunk[] {
  const alvo = Math.max(200, op.alvoChars ?? 1200);
  const maxChars = Math.max(alvo, op.maxChars ?? 2000);
  const sobre = Math.max(0, Math.min(op.sobreposicao ?? 150, Math.floor(alvo / 2), Math.max(0, maxChars - alvo)));
  const markdown = op.respeitarMarkdown ?? true;
  if (texto.trim() === "") return [];
  // unidades "atômicas": ou cabem em maxChars, ou são cortadas antes de empacotar
  const atomos: Unidade[] = [];
  for (const u of unidades(texto, markdown)) {
    if (u.fim - u.inicio <= maxChars) atomos.push(u);
    else for (const [a, b] of cortar(texto, u.inicio, u.fim, Math.min(maxChars, alvo))) atomos.push({ ...u, inicio: a, fim: b, cerca: false });
  }
  const chunks: Chunk[] = [];
  const emitir = (ini: number, fim: number, titulos: string[]): void => {
    let a = ini;
    let b = fim;
    while (a < b && /\s/.test(texto.charAt(a))) a++;
    while (b > a && /\s/.test(texto.charAt(b - 1))) b--;
    if (b <= a) return;
    const t = texto.slice(a, b);
    chunks.push({ ordem: chunks.length, texto: t, inicio: a, fim: b, titulos, hash: sha256(t) });
  };
  let i = 0;
  while (i < atomos.length) {
    const primeiro = atomos[i] as Unidade;
    let fim = primeiro.fim;
    let j = i + 1;
    while (j < atomos.length) {
      const prox = atomos[j] as Unidade;
      if (prox.fim - primeiro.inicio > alvo || prox.secao !== primeiro.secao) break; // chunk não atravessa título
      fim = prox.fim;
      j++;
    }
    // sobreposição só dentro da mesma seção (não atravessa título novo) e sem ultrapassar maxChars
    let inicio = primeiro.inicio;
    const anterior = chunks[chunks.length - 1];
    if (sobre > 0 && anterior && i > 0 && (atomos[i - 1] as Unidade).secao === primeiro.secao && !primeiro.cerca && !(atomos[i - 1] as Unidade).cerca) {
      const desejado = Math.max(anterior.inicio + 1, primeiro.inicio - sobre);
      const novoIni = bordaDePalavra(texto, desejado, anterior.inicio + 1, primeiro.inicio);
      if (fim - novoIni <= maxChars) inicio = novoIni;
    }
    emitir(inicio, fim, primeiro.titulos);
    i = j;
  }
  return chunks;
}

export interface DocumentoPreparado {
  chunks: Chunk[];
  redigido: boolean;
  substituicoes: number;
  /** texto normalizado e redigido (base dos deslocamentos dos chunks). */
  texto: string;
}

/** ÚNICO ponto de entrada do que vai a índice: redigir → normalizar → chunkar; `hash` é do chunk já redigido. */
export function prepararDocumento(entrada: { origem: string; texto: string }, op: OpcoesChunk & OpcoesRedacao = {}): DocumentoPreparado {
  const r = redigirTexto(entrada.texto, op.scrubber ? { scrubber: op.scrubber } : {});
  const normal = normalizarParaIndice(r.texto);
  return { chunks: dividirEmChunks(normal, op), redigido: r.redigido, substituicoes: r.substituicoes, texto: normal };
}
