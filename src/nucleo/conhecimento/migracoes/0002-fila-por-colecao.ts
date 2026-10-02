// 0002 (Fase 15, auditoria): a fila de ingestão ganha a COLEÇÃO dona do item. Sem isso, o serviço de um workspace drenava a fila inteira e
// gravava eventos de OUTRO workspace na própria coleção (vazamento entre workspaces). Fila é transitória: o que existia sem dono é descartado.
import type { Migracao } from "../../banco/migrar";

export const migracaoConhecimento0002: Migracao = {
  versao: 2,
  nome: "conhecimento-0002-fila-por-colecao",
  aplicar(banco) {
    banco.executar("DELETE FROM rag_fila");
    banco.executar("ALTER TABLE rag_fila ADD COLUMN colecao_id TEXT");
    banco.executar("CREATE INDEX ix_fila_colecao ON rag_fila (colecao_id, prioridade, id)");
  },
};
