// Esquecer: remove chunks, FTS (gatilho), vetores, nós/arestas órfãos e grava tombstone(hash) para a fonte não reentrar.
import type { FiltroRemocao, Repos } from "../repos";
import type { GerenciadorIndices } from "../indice/gerenciador";
import type { Banco } from "../../banco/banco";

/**
 * "Esquecer" de verdade (auditoria A-03): o DELETE comum deixa o texto legível em páginas livres, no WAL e nos segmentos do FTS5. Aqui:
 * `secure_delete` (zera as páginas), `optimize` do FTS5 (funde os segmentos que ainda tinham os termos) e checkpoint TRUNCATE (descarta o
 * WAL antigo). Melhor esforço: nunca impede a exclusão (sem FTS5 ou com leitor ativo o apagamento já foi feito).
 */
export function apagarDeVerdade<T>(banco: Banco, apagar: () => T): T {
  let anterior = 0;
  try {
    anterior = Number(banco.consultarUm<{ secure_delete: number }>("PRAGMA secure_delete")?.secure_delete ?? 0);
    banco.executar("PRAGMA secure_delete = ON");
  } catch {
    /* sem o pragma: segue com o DELETE comum */
  }
  try {
    return apagar();
  } finally {
    for (const sql of ["INSERT INTO rag_chunk_fts(rag_chunk_fts) VALUES('optimize')", "PRAGMA wal_checkpoint(TRUNCATE)", `PRAGMA secure_delete = ${anterior === 1 ? "ON" : anterior === 2 ? "FAST" : "OFF"}`]) {
      try {
        banco.executar(sql);
      } catch {
        /* FTS5 ausente ou leitor ativo */
      }
    }
  }
}

export function esquecer(repos: Repos, indices: GerenciadorIndices, colecao_id: string, filtro: FiltroRemocao): { removidos: number } {
  const r = apagarDeVerdade(repos.banco, () => repos.documento.remover(colecao_id, filtro, true));
  indices.remover(colecao_id, r.chunks);
  return { removidos: r.removidos };
}

/** Apagar TUDO exige a confirmação digitada (nome do workspace). Não grava tombstone: o usuário pode reindexar depois. */
export function purgar(repos: Repos, indices: GerenciadorIndices, colecao_id: string, confirmacao: string, nomeEsperado: string): { removidos: number } | null {
  if (confirmacao.trim() === "" || confirmacao !== nomeEsperado) return null;
  const r = apagarDeVerdade(repos.banco, () => {
    const x = repos.documento.remover(colecao_id, { tudo: true }, false);
    repos.banco.executar("DELETE FROM rag_no WHERE colecao_id = ?", [colecao_id]);
    repos.banco.executar("DELETE FROM rag_aprendizado WHERE colecao_id = ?", [colecao_id]);
    repos.banco.executar("DELETE FROM rag_fonte WHERE colecao_id = ?", [colecao_id]);
    repos.banco.executar("DELETE FROM rag_consulta WHERE colecao_id = ?", [colecao_id]);
    repos.banco.executar("DELETE FROM rag_fila WHERE colecao_id = ?", [colecao_id]);
    return x;
  });
  indices.descartar(colecao_id);
  return { removidos: r.removidos };
}
