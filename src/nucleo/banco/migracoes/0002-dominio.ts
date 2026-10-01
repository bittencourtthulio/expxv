import type { Migracao } from "../migrar";

// Índices das listagens paginadas por cursor (id ULID) dos repositórios (P-14: consulta quente ≤ 5 ms).
// Sem colunas novas: o schema de 05-CONTRATOS.md §1 não muda.
const SQL = `
CREATE INDEX ix_mission_workspace_id ON mission (workspace_id, id DESC);
CREATE INDEX ix_mission_workspace_estado_id ON mission (workspace_id, estado, id DESC);
CREATE INDEX ix_pane_workspace_id ON pane (workspace_id, id);
CREATE INDEX ix_pane_workspace_ativo_id ON pane (workspace_id, id) WHERE estado <> 'encerrado';
CREATE INDEX ix_task_mission_id ON task (mission_id, id);
`;

export const migracao0002: Migracao = {
  versao: 2,
  nome: "0002-dominio",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
