// Chunking (T-15.06): todo chunk sai determinístico, ≤ 2 000 caracteres, com `termos` (identificadores quebrados) e hash do
// texto JÁ redigido. A redação acontece ANTES de chunkar (`prepararDocumento` da Fase 8 é o ponto único para markdown).
import { CHUNK_ALVO, CHUNK_MAX, CHUNK_SOBREPOSICAO } from "../constantes";
import { termosDeIdentificadores } from "../fts";
import { sha256 } from "../ids";
import { prepararDocumento } from "../../memoria/ingestao";
import { redigirTexto, type OpcoesRedacao } from "../../memoria/redacao";

export interface ChunkPronto {
  ordem: number;
  texto: string;
  /** títulos ancestrais separados por " › ". */
  titulos: string;
  termos: string;
  hash: string;
}

export interface OpcoesChunking extends OpcoesRedacao {
  alvoChars?: number;
}

export function montar(itens: ReadonlyArray<{ texto: string; titulos?: string }>): ChunkPronto[] {
  const saida: ChunkPronto[] = [];
  for (const it of itens) {
    const texto = it.texto.length > CHUNK_MAX ? it.texto.slice(0, CHUNK_MAX) : it.texto;
    if (texto.trim() === "") continue;
    saida.push({ ordem: saida.length, texto, titulos: (it.titulos ?? "").slice(0, 300), termos: termosDeIdentificadores(`${it.titulos ?? ""} ${texto}`), hash: sha256(texto) });
  }
  return saida;
}

/** Markdown/texto corrido: redigir → normalizar → chunkar por título > parágrafo (reusa `dividirEmChunks`). */
export function chunksDeMarkdown(origem: string, texto: string, op: OpcoesChunking = {}): { chunks: ChunkPronto[]; redigido: boolean; texto: string } {
  const prep = prepararDocumento({ origem, texto }, { alvoChars: op.alvoChars ?? CHUNK_ALVO, sobreposicao: CHUNK_SOBREPOSICAO, maxChars: CHUNK_MAX, ...(op.scrubber ? { scrubber: op.scrubber } : {}) });
  return { chunks: montar(prep.chunks.map((c) => ({ texto: c.texto, titulos: c.titulos.join(" › ") }))), redigido: prep.redigido, texto: prep.texto };
}

/** Redige um texto curto (uma linha ou bloco) sem chunkar. */
export const redigir = (texto: string, op: OpcoesRedacao = {}): string => redigirTexto(texto, op).texto;

/** Cortes de `linhas` em janelas que respeitam `maxLinhas` e `maxChars` (linha gigante é cortada a ferro). */
export function janelas(linhas: readonly string[], maxLinhas: number, maxChars: number): string[] {
  const saida: string[] = [];
  let atual: string[] = [];
  let chars = 0;
  const fechar = (): void => {
    if (atual.length > 0) saida.push(atual.join("\n"));
    atual = [];
    chars = 0;
  };
  for (const l of linhas) {
    const partes = l.length > maxChars ? (l.match(new RegExp(`[\\s\\S]{1,${maxChars}}`, "g")) ?? [l]) : [l];
    for (const p of partes) {
      if (atual.length >= maxLinhas || chars + p.length + 1 > maxChars) fechar();
      atual.push(p);
      chars += p.length + 1;
    }
  }
  fechar();
  return saida;
}
