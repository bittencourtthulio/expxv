// Corpus SINTÉTICO do conhecimento (T-15.47): semente fixa, sem rede, sem segredo. Insere direto no conhecimento.db (prepared statements
// em transações grandes) para montar 1 k / 10 k / 50 k chunks em segundos; vetores aleatórios L2-normalizados (determinísticos).
import type { Banco } from "../../../src/nucleo/banco/banco";
import { uuid5 } from "../../../src/nucleo/conhecimento/ids";

export function prng(semente: number): () => number {
  let s = semente >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0xffffffff);
}

const SIL = ["ba", "co", "di", "fe", "gu", "ha", "jo", "ki", "lu", "me", "no", "pa", "qui", "ro", "sa", "te", "vu", "xa", "zi", "tra", "pro", "cli", "est", "ver"];

/** Vocabulário pseudo-palavras; `vocabulario(n)` é estável. */
export function vocabulario(n: number, semente = 42): string[] {
  const r = prng(semente);
  const v = new Set<string>();
  while (v.size < n) {
    const k = 2 + Math.floor(r() * 3);
    v.add(Array.from({ length: k }, () => SIL[Math.floor(r() * SIL.length)] as string).join(""));
  }
  return [...v];
}

export interface OpcoesCorpus {
  chunks: number;
  chunksPorDoc?: number;
  dim?: number;
  semente?: number;
  colecao_id: string;
  modelo: string;
  /** palavras por chunk (≈ 200 chars com 40). */
  palavras?: number;
}

const TIPOS = ["doc", "doc", "relatorio", "decisao", "commit", "task", "codigo", "codigo", "handoff", "aprendizado"] as const;

export interface CorpusGerado {
  chunks: number;
  documentos: number;
  vocab: string[];
  raros: string[];
}

export function vetorAleatorio(r: () => number, dim: number): Float32Array {
  const v = new Float32Array(dim);
  let n = 0;
  for (let i = 0; i < dim; i++) {
    const x = r() - 0.5;
    v[i] = x;
    n += x * x;
  }
  const inv = 1 / Math.sqrt(n);
  for (let i = 0; i < dim; i++) v[i] = Math.fround((v[i] as number) * inv);
  return v;
}

export function gerarCorpus(banco: Banco, o: OpcoesCorpus): CorpusGerado {
  const r = prng(o.semente ?? 7);
  const dim = o.dim ?? 256;
  const porDoc = o.chunksPorDoc ?? 5;
  const palavras = o.palavras ?? 40;
  const vocab = vocabulario(4000);
  const raros: string[] = [];
  const T = "2026-08-01T00:00:00.000Z";
  const zipf = (): string => vocab[Math.min(vocab.length - 1, Math.floor(Math.pow(r(), 3) * vocab.length))] as string;
  let docs = 0;
  banco.transacao((tx) => {
    const insDoc = tx.preparar("INSERT INTO rag_documento (id,colecao_id,tipo,origem,titulo,hash_conteudo,fonte,importancia,estado,ocorrido_em,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,'sistema',3,'ativo',?,?,?)");
    const insChunk = tx.preparar("INSERT INTO rag_chunk (id,documento_id,ordem,texto,titulos,termos,hash,criado_em) VALUES (?,?,?,?,?,?,?,?)");
    const insVet = tx.preparar("INSERT INTO rag_vetor (chunk_id,modelo,dimensao,q,escala,vetor) VALUES (?,?,?,0,NULL,?)");
    let c = 0;
    while (c < o.chunks) {
      const tipo = TIPOS[docs % TIPOS.length] as string;
      const origem = `${tipo === "codigo" ? "src" : "docs"}/m${docs % 50}/arq${docs}.${tipo === "codigo" ? "ts" : "md"}`;
      const docId = uuid5(`doc|${origem}|${tipo}`);
      const quando = new Date(Date.parse(T) + docs * 60_000).toISOString();
      insDoc.executar([docId, o.colecao_id, tipo, origem, `Documento ${docs}`, `h${docs}`, quando, quando, quando]);
      docs++;
      for (let i = 0; i < porDoc && c < o.chunks; i++, c++) {
        const ws: string[] = [];
        for (let k = 0; k < palavras; k++) ws.push(zipf());
        if (c % 500 === 0) {
          const raro = `zx${c}q`;
          raros.push(raro);
          ws.splice(5, 0, raro);
        }
        const texto = ws.join(" ");
        const id = uuid5(`chunk|${docId}|${i}`);
        insChunk.executar([id, docId, i, texto, "", "", `x${c}`, quando]);
        const v = vetorAleatorio(r, dim);
        insVet.executar([id, o.modelo, dim, new Uint8Array(v.buffer, 0, v.byteLength)]);
      }
    }
  });
  return { chunks: o.chunks, documentos: docs, vocab, raros };
}

/** Consulta de 3 termos do vocabulário (determinística pela semente). */
export function consultasSinteticas(vocab: readonly string[], n: number, semente = 99): string[] {
  const r = prng(semente);
  return Array.from({ length: n }, () => [0, 1, 2].map(() => vocab[Math.floor(Math.pow(r(), 2) * vocab.length)] as string).join(" "));
}
