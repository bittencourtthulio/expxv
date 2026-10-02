// Braço lexical: BM25 por FTS5 (`bm25(rag_chunk_fts, 1.0, 0.6, 1.4)`); sem FTS5, LIKE com teto de varredura de 5 000 linhas.
import type { Banco } from "../../banco/banco";
import { consultaMatchInteligente, ftsDisponivel, termosDaConsulta } from "../fts";
import type { FiltroBusca } from "../tipos";

export const TETO_LIKE = 5000;

function filtroSql(colecao_id: string, f: FiltroBusca): { sql: string; args: Array<string | number> } {
  let sql = "d.colecao_id = ? AND d.estado = 'ativo'";
  const args: Array<string | number> = [colecao_id];
  if (f.tipos && f.tipos.length > 0) (sql += ` AND d.tipo IN (${f.tipos.map(() => "?").join(",")})`), args.push(...f.tipos);
  if (f.desde) (sql += " AND d.ocorrido_em >= ?"), args.push(f.desde);
  if (f.mission_id) (sql += " AND d.mission_id = ?"), args.push(f.mission_id);
  return { sql, args };
}

/** Ids de chunk que passam no filtro (para restringir o braço vetorial). `null` = sem filtro (a coleção inteira). */
export function chunksPermitidos(banco: Banco, colecao_id: string, f: FiltroBusca): Set<string> | null {
  if (!(f.tipos && f.tipos.length > 0) && !f.desde && !f.mission_id) return null;
  const { sql, args } = filtroSql(colecao_id, f);
  return new Set(banco.consultar<{ id: string }>(`SELECT c.id FROM rag_chunk c JOIN rag_documento d ON d.id = c.documento_id WHERE ${sql}`, args).map((r) => r.id));
}

export function buscarLexical(banco: Banco, colecao_id: string, consulta: string, f: FiltroBusca, limite = 100): string[] {
  const { sql, args } = filtroSql(colecao_id, f);
  if (termosDaConsulta(consulta).length === 0) return [];
  if (ftsDisponivel(banco)) {
    try {
      const total = Number(banco.consultarUm<{ n: number }>("SELECT max(rowid) AS n FROM rag_chunk")?.n ?? 0);
      const match = consultaMatchInteligente(banco, consulta, total);
      if (match === null) return [];
      // FTS primeiro (top-N por BM25) e só então junta/filtra: o planner não varre rag_chunk inteiro
      const sobre = Math.max(limite * 3, 300) * (f.tipos?.length || f.desde || f.mission_id ? 4 : 1);
      return banco
        .consultar<{ id: string }>(
          `SELECT c.id FROM (SELECT rowid AS rid, bm25(rag_chunk_fts, 1.0, 0.6, 1.4) AS r FROM rag_chunk_fts WHERE rag_chunk_fts MATCH ? ORDER BY r LIMIT ?) x
           JOIN rag_chunk c ON c.rowid = x.rid JOIN rag_documento d ON d.id = c.documento_id
           WHERE ${sql} ORDER BY x.r, c.id LIMIT ?`,
          [match, sobre, ...args, limite],
        )
        .map((r) => r.id);
    } catch {
      /* MATCH inválido: cai no LIKE */
    }
  }
  const termos = termosDaConsulta(consulta).map((t) => t.toLowerCase());
  const cond = termos.map(() => "(lower(c.texto) LIKE ? ESCAPE '\\' OR c.termos LIKE ? ESCAPE '\\')").join(" OR ");
  const pars = termos.flatMap((t) => {
    const p = `%${t.replace(/[\\%_]/g, "\\$&")}%`;
    return [p, p];
  });
  const linhas = banco.consultar<{ id: string; texto: string; termos: string }>(
    `SELECT c.id, c.texto, c.termos FROM rag_chunk c JOIN rag_documento d ON d.id = c.documento_id WHERE ${sql} AND (${cond}) LIMIT ${TETO_LIKE}`,
    [...args, ...pars],
  );
  const pontos = linhas.map((l) => {
    const t = `${l.texto.toLowerCase()} ${l.termos}`;
    return { id: l.id, p: termos.reduce((s, x) => s + (t.includes(x) ? 1 : 0), 0) };
  });
  pontos.sort((a, b) => b.p - a.p || (a.id < b.id ? -1 : 1));
  return pontos.slice(0, limite).map((p) => p.id);
}
