import type { Migracao } from "../migrar";

// AUD-05: o aviso ao piloto (wake) é gravado NA MESMA transação do handoff e só sai da tabela depois de entregue;
// uma queda entre o banco e a entrega não perde o aviso (o boot reenfileira). AUD-31: índices das consultas de
// orquestração (`handoff` por Pane de origem; `pane` por sessão do PTY).
const SQL = `
CREATE TABLE wake_pendente (
  handoff_id TEXT PRIMARY KEY,
  destino_pane_id TEXT NOT NULL,
  origem_pane_id TEXT NOT NULL,
  task_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','parcial','bloqueado','falhou')),
  resumo TEXT NOT NULL,
  relatorio_path TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_wake_pendente_destino ON wake_pendente (destino_pane_id, criado_em);
CREATE INDEX ix_handoff_de_pane ON handoff (de_pane_id, id DESC);
CREATE INDEX ix_pane_sessao_pty ON pane (sessao_pty_id);
`;

export const migracao0003: Migracao = {
  versao: 3,
  nome: "0003-wake-pendente",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
