// FTS5 do conhecimento (D-52, DEC-1): fora da migration, detectado POR TENTATIVA, idempotente. Sem FTS5 cai em LIKE com teto.
import type { Banco } from "../banco";

const estado = new WeakMap<Banco, boolean>();
/** Teste: força a ausência de FTS5 (cai em LIKE). */
const forcarAusencia = new WeakSet<Banco>();

const DDL = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunk_fts USING fts5(texto, titulos, termos, content='rag_chunk', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`,
  // vocabulário (frequência de documento por termo): permite descartar termos comuns da consulta (BM25 só sobre o que discrimina)
  `CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunk_fts_v USING fts5vocab(rag_chunk_fts, 'row')`,
  `CREATE TRIGGER IF NOT EXISTS rag_chunk_fts_ai AFTER INSERT ON rag_chunk BEGIN
     INSERT INTO rag_chunk_fts(rowid, texto, titulos, termos) VALUES (new.rowid, new.texto, new.titulos, new.termos);
   END`,
  `CREATE TRIGGER IF NOT EXISTS rag_chunk_fts_ad AFTER DELETE ON rag_chunk BEGIN
     INSERT INTO rag_chunk_fts(rag_chunk_fts, rowid, texto, titulos, termos) VALUES ('delete', old.rowid, old.texto, old.titulos, old.termos);
   END`,
  `CREATE TRIGGER IF NOT EXISTS rag_chunk_fts_au AFTER UPDATE OF texto, titulos, termos ON rag_chunk BEGIN
     INSERT INTO rag_chunk_fts(rag_chunk_fts, rowid, texto, titulos, termos) VALUES ('delete', old.rowid, old.texto, old.titulos, old.termos);
     INSERT INTO rag_chunk_fts(rowid, texto, titulos, termos) VALUES (new.rowid, new.texto, new.titulos, new.termos);
   END`,
];

/** Cria (se der) a tabela virtual e os gatilhos; reconstrói se o índice divergiu. Nunca lança. */
export function garantirFts(banco: Banco, opcoes: { simularAusencia?: boolean } = {}): boolean {
  if (opcoes.simularAusencia === true) {
    forcarAusencia.add(banco);
    estado.set(banco, false);
    return false;
  }
  forcarAusencia.delete(banco);
  try {
    const existia = banco.consultarUm("SELECT 1 AS x FROM sqlite_master WHERE name = 'rag_chunk_fts'") !== undefined;
    for (const sql of DDL) banco.executar(sql);
    if (!existia) banco.executar("INSERT INTO rag_chunk_fts(rag_chunk_fts) VALUES ('rebuild')");
    else {
      const docs = Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_chunk_fts_docsize")?.n ?? 0);
      const total = Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_chunk")?.n ?? 0);
      if (docs !== total) banco.executar("INSERT INTO rag_chunk_fts(rag_chunk_fts) VALUES ('rebuild')");
    }
    estado.set(banco, true);
    return true;
  } catch {
    estado.set(banco, false);
    return false;
  }
}

export const ftsDisponivel = (banco: Banco): boolean => estado.get(banco) === true;

const palavras = (q: string): string[] =>
  (q.normalize("NFKC").match(/[\p{L}\p{N}_]{2,}/gu) ?? []).filter((t) => !/^(?:near|and|or|not)$/i.test(t)).slice(0, 16);

/** Consulta segura para MATCH: só palavras entre aspas, OR entre elas, prefixo `*` no último. `null` se não sobrar termo. */
export function consultaMatch(q: string): string | null {
  const t = palavras(q);
  if (t.length === 0) return null;
  return t.map((p, i) => `"${p.replace(/"/g, "")}"${i === t.length - 1 ? "*" : ""}`).join(" OR ");
}

export const termosDaConsulta = palavras;

/** Fração de documentos acima da qual um termo é "comum" e sai da consulta (se sobrar termo mais raro). */
export const LIMIAR_TERMO_COMUM = 0.08;
const MAX_TERMOS_MATCH = 6;

/**
 * MATCH que descarta termos comuns: usa a frequência de documento (`fts5vocab`) para ficar só com os termos que discriminam, do mais
 * raro ao mais comum (≤ 6). Prefixo `*` só em termo ≥ 4 caracteres e ausente do índice (digitação parcial). Sem vocabulário cai na
 * consulta simples. Mantém o custo do BM25 proporcional ao que casa de verdade (P-70).
 */
export function consultaMatchInteligente(banco: Banco, q: string, totalChunks: number): string | null {
  const termos = [...new Set(palavras(q).map((t) => t.toLowerCase()))];
  if (termos.length === 0) return null;
  let df: Map<string, number>;
  try {
    df = new Map();
    const st = banco.preparar<{ doc: number }>("SELECT doc FROM rag_chunk_fts_v WHERE term = ?");
    for (const t of termos) df.set(t, Number(st.consultarUm([t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")])?.doc ?? 0));
  } catch {
    return consultaMatch(q);
  }
  const limite = Math.max(50, totalChunks * LIMIAR_TERMO_COMUM);
  const conhecidos = termos.filter((t) => (df.get(t) ?? 0) > 0).sort((a, b) => (df.get(a) as number) - (df.get(b) as number));
  const raros = conhecidos.filter((t) => (df.get(t) as number) <= limite);
  const escolhidos = (raros.length > 0 ? raros : conhecidos.slice(0, 2)).slice(0, MAX_TERMOS_MATCH);
  const prefixos = termos.filter((t) => (df.get(t) ?? 0) === 0 && t.length >= 4).slice(0, 2);
  const partes = [...escolhidos.map((t) => `"${t.replace(/"/g, "")}"`), ...prefixos.map((t) => `"${t.replace(/"/g, "")}"*`)];
  return partes.length === 0 ? null : partes.join(" OR ");
}

/** Identificadores quebrados (camelCase, snake_case, kebab, pontos) para a coluna `termos`. */
export function termosDeIdentificadores(texto: string, max = 400): string {
  const vistos = new Set<string>();
  for (const id of texto.match(/[A-Za-z_][A-Za-z0-9_]{3,}/g) ?? []) {
    const partes = id
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[_\s]+/)
      .map((p) => p.toLowerCase())
      .filter((p) => p.length >= 2);
    if (partes.length > 1) for (const p of partes) vistos.add(p);
    vistos.add(id.toLowerCase());
    if (vistos.size >= max) break;
  }
  return [...vistos].join(" ");
}
