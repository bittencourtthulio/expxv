import type { Migracao } from "../migrar";

// Fase 14 (T-14.03): squads e agentes. As squads em si são ARQUIVOS (D-201); o banco guarda só o vínculo com a Missão,
// as invocações de agente (auditoria, paralelismo, custo) e os prompts enviados pela caixa da área Squads.
// Datas: UTC ISO com ms. Booleano: INTEGER 0/1. Nenhuma coluna guarda texto de prompt de membro nem segredo
// (`objetivo` é gravado já redigido pelo serviço; `prompt_hash` é só o sha256).
const SQL = `
ALTER TABLE mission ADD COLUMN squad_id TEXT;
ALTER TABLE pane ADD COLUMN agente_id TEXT;
CREATE INDEX ix_mission_squad ON mission (squad_id) WHERE squad_id IS NOT NULL;
CREATE INDEX ix_pane_agente ON pane (agente_id) WHERE agente_id IS NOT NULL;

CREATE TABLE mission_squad (
  mission_id TEXT PRIMARY KEY REFERENCES mission(id) ON DELETE CASCADE,
  squad_slug TEXT NOT NULL CHECK (squad_slug <> ''),
  squad_hash TEXT NOT NULL CHECK (length(squad_hash) = 64),
  portoes_pendentes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(portoes_pendentes_json) AND json_type(portoes_pendentes_json) = 'array'),
  nivel_rigidez INTEGER CHECK (nivel_rigidez IS NULL OR nivel_rigidez BETWEEN 1 AND 5),
  plano_antes INTEGER NOT NULL DEFAULT 1 CHECK (plano_antes IN (0,1)),
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_mission_squad_slug ON mission_squad (squad_slug);

CREATE TABLE invocacao_agente (
  id TEXT PRIMARY KEY,
  mission_id TEXT REFERENCES mission(id) ON DELETE CASCADE,
  pane_id TEXT REFERENCES pane(id) ON DELETE SET NULL,
  agente_id TEXT NOT NULL CHECK (agente_id <> '' AND length(agente_id) <= 80),
  task_ref TEXT,
  perfil_json TEXT NOT NULL CHECK (json_valid(perfil_json)),
  prompt_hash TEXT NOT NULL CHECK (prompt_hash <> ''),
  recibo TEXT CHECK (recibo IS NULL OR length(recibo) <= 240),
  criado_em TEXT NOT NULL,
  encerrada_em TEXT,
  CHECK (encerrada_em IS NULL OR encerrada_em >= criado_em)
);
CREATE INDEX ix_invocacao_mission ON invocacao_agente (mission_id, criado_em);
CREATE INDEX ix_invocacao_agente_vivas ON invocacao_agente (mission_id, agente_id) WHERE encerrada_em IS NULL;
CREATE INDEX ix_invocacao_pane ON invocacao_agente (pane_id) WHERE pane_id IS NOT NULL;

CREATE TABLE squad_execucao (
  id TEXT PRIMARY KEY,
  squad_slug TEXT NOT NULL CHECK (squad_slug <> ''),
  squad_hash TEXT NOT NULL CHECK (length(squad_hash) = 64),
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  mission_id TEXT REFERENCES mission(id) ON DELETE SET NULL,
  objetivo TEXT NOT NULL CHECK (length(objetivo) BETWEEN 1 AND 4000),
  plano_antes INTEGER NOT NULL CHECK (plano_antes IN (0,1)),
  nivel_rigidez INTEGER CHECK (nivel_rigidez IS NULL OR nivel_rigidez BETWEEN 1 AND 5),
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_squad_execucao_criado ON squad_execucao (criado_em DESC);
CREATE INDEX ix_squad_execucao_workspace ON squad_execucao (workspace_id, id DESC);
CREATE UNIQUE INDEX ux_squad_execucao_mission ON squad_execucao (mission_id) WHERE mission_id IS NOT NULL;
`;

export const migracao0006: Migracao = {
  versao: 6,
  nome: "0006-squads",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
