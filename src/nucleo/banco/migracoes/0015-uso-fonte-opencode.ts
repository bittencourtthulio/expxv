import type { Migracao } from "../migrar";

// Fase 10 (P-82): `uso_fonte.base` passa a aceitar 'opencode_data' (o `opencode.db` do OpenCode, SQLite lido só em leitura; `relativo` = `opencode.db#<id da sessão>`).
// O SQLite não altera um CHECK: a tabela é recriada com os mesmos campos e índices. `uso_registro` tem FK `ON DELETE CASCADE` para `uso_fonte`, e `PRAGMA foreign_keys`
// não muda dentro de transação; por isso as linhas de `uso_registro` são guardadas numa tabela temporária e devolvidas depois do DROP (nada se perde, nada duplica).
const SQL = `
CREATE TEMP TABLE _uso_registro_bak AS SELECT * FROM uso_registro;
CREATE TABLE uso_fonte_nova (
  id TEXT PRIMARY KEY,
  cli TEXT NOT NULL,
  conta_id TEXT REFERENCES conta(id) ON DELETE SET NULL,
  pane_id TEXT REFERENCES pane(id) ON DELETE SET NULL,
  mission_id TEXT,
  workspace_id TEXT,
  base TEXT NOT NULL CHECK (base IN ('claude_config','codex_home','proxy','nenhuma','opencode_data')),
  relativo TEXT NOT NULL,
  offset INTEGER NOT NULL DEFAULT 0,
  tamanho INTEGER NOT NULL DEFAULT 0,
  mtime_ms INTEGER,
  inode TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('lendo','sem_fonte','erro','encerrada')),
  erro_codigo TEXT,
  linhas_puladas INTEGER NOT NULL DEFAULT 0,
  ultima_leitura_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
INSERT INTO uso_fonte_nova SELECT id,cli,conta_id,pane_id,mission_id,workspace_id,base,relativo,offset,tamanho,mtime_ms,inode,estado,erro_codigo,linhas_puladas,ultima_leitura_em,criado_em,atualizado_em FROM uso_fonte;
DROP TABLE uso_fonte;
ALTER TABLE uso_fonte_nova RENAME TO uso_fonte;
CREATE UNIQUE INDEX ux_uso_fonte ON uso_fonte (base, COALESCE(conta_id,''), relativo) WHERE relativo <> '';
CREATE UNIQUE INDEX ux_uso_fonte_pane ON uso_fonte (pane_id, base) WHERE relativo = '' AND pane_id IS NOT NULL;
CREATE INDEX ix_uso_fonte_pane ON uso_fonte (pane_id);
INSERT OR IGNORE INTO uso_registro SELECT * FROM _uso_registro_bak;
DROP TABLE _uso_registro_bak;
`;

export const migracao0015: Migracao = {
  versao: 15,
  nome: "0015-uso-fonte-opencode",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
