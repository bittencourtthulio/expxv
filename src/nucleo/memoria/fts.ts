// FTS5 da memória (D-52): fora da migration, detectado POR TENTATIVA, idempotente. Sem FTS5 a busca cai em LIKE com teto.
import type { Banco } from "../banco";

const estado = new WeakMap<Banco, boolean>();

const DDL = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS memoria_fts USING fts5(conteudo, content='memoria_entrada', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`,
  `CREATE TRIGGER IF NOT EXISTS memoria_fts_ai AFTER INSERT ON memoria_entrada BEGIN
     INSERT INTO memoria_fts(rowid, conteudo) VALUES (new.rowid, new.conteudo);
   END`,
  `CREATE TRIGGER IF NOT EXISTS memoria_fts_ad AFTER DELETE ON memoria_entrada BEGIN
     INSERT INTO memoria_fts(memoria_fts, rowid, conteudo) VALUES ('delete', old.rowid, old.conteudo);
   END`,
  `CREATE TRIGGER IF NOT EXISTS memoria_fts_au AFTER UPDATE OF conteudo ON memoria_entrada BEGIN
     INSERT INTO memoria_fts(memoria_fts, rowid, conteudo) VALUES ('delete', old.rowid, old.conteudo);
     INSERT INTO memoria_fts(rowid, conteudo) VALUES (new.rowid, new.conteudo);
   END`,
];

/** Cria (se der) a tabela virtual e os gatilhos; reconstrói se o índice divergiu. Devolve se o FTS5 está utilizável. Nunca lança. */
export function garantirFts(banco: Banco): boolean {
  try {
    const existia = banco.consultarUm("SELECT 1 AS x FROM sqlite_master WHERE name = 'memoria_fts'") !== undefined;
    for (const sql of DDL) banco.executar(sql);
    if (!existia) {
      banco.executar("INSERT INTO memoria_fts(memoria_fts) VALUES ('rebuild')");
    } else {
      const docs = Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_fts_docsize")?.n ?? 0);
      const total = Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_entrada")?.n ?? 0);
      if (docs !== total) banco.executar("INSERT INTO memoria_fts(memoria_fts) VALUES ('rebuild')");
    }
    estado.set(banco, true);
    return true;
  } catch {
    estado.set(banco, false);
    return false;
  }
}

/** Resultado da última tentativa neste banco (false se nunca tentou). */
export const ftsDisponivel = (banco: Banco): boolean => estado.get(banco) === true;

/** Sanitiza a consulta para o MATCH: só palavras (prefixo `*` no último termo), sem operadores FTS (`" * ^ - NEAR AND OR NOT`). */
export function consultaFts(query: string, ou = false): string | null {
  const termos = (query.normalize("NFKC").match(/[\p{L}\p{N}_]{2,}/gu) ?? []).filter((t) => !/^(?:near|and|or|not)$/i.test(t)).slice(0, 12);
  if (termos.length === 0) return null;
  return termos.map((t, i) => `"${t.replace(/"/g, "")}"${i === termos.length - 1 ? "*" : ""}`).join(ou ? " OR " : " ");
}
