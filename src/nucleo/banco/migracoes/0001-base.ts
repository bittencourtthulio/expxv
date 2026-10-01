import type { Migracao } from "../migrar";

// Schema de docs/ade/05-CONTRATOS.md §1. Datas: UTC ISO com ms (TEXT). Booleanos: INTEGER 0/1.
// Referências circulares (mission.piloto_pane_id, task.handoff_id) ficam sem FK declarada; a
// integridade é garantida na camada de repositório (T-02.01), dentro de transação.
const SQL = `
CREATE TABLE workspace (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  raiz TEXT NOT NULL,
  e_git INTEGER NOT NULL DEFAULT 0 CHECK (e_git IN (0,1)),
  acesso_externo TEXT NOT NULL DEFAULT 'nenhum' CHECK (acesso_externo IN ('nenhum','leitura','leitura_escrita')),
  permissao TEXT NOT NULL DEFAULT 'seguro' CHECK (permissao IN ('seguro','automatico')),
  ultimo_uso_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ix_workspace_raiz ON workspace (raiz);
CREATE INDEX ix_workspace_ultimo_uso ON workspace (ultimo_uso_em DESC);

CREATE TABLE mission (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  modo TEXT NOT NULL CHECK (modo IN ('livre','squad','agentico')),
  origem TEXT NOT NULL CHECK (origem IN ('livre','feature','ocorrencia','pedido','projeto')),
  trabalho_id TEXT,
  titulo TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('intake','planejando','executando','revisando','concluida','falhou','abortada')),
  worktree TEXT,
  branch TEXT,
  piloto_pane_id TEXT,
  concluida_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_mission_workspace_estado ON mission (workspace_id, estado);

CREATE TABLE conta (
  id TEXT PRIMARY KEY,
  provedor TEXT NOT NULL,
  rotulo TEXT NOT NULL,
  config_dir_ref TEXT,
  habilitada INTEGER NOT NULL DEFAULT 1 CHECK (habilitada IN (0,1)),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_conta_provedor ON conta (provedor);

CREATE TABLE pane (
  id TEXT PRIMARY KEY,
  mission_id TEXT REFERENCES mission(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  display_id INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('cli','shell')),
  cli TEXT,
  executavel_id TEXT,
  conta_id TEXT REFERENCES conta(id) ON DELETE SET NULL,
  modelo TEXT,
  esforco TEXT,
  papel TEXT NOT NULL DEFAULT 'nenhum' CHECK (papel IN ('piloto','executor','explorador','revisor','nenhum')),
  eh_piloto INTEGER NOT NULL DEFAULT 0 CHECK (eh_piloto IN (0,1)),
  estado TEXT NOT NULL CHECK (estado IN ('iniciando','pronto','trabalhando','aguardando','bloqueado','encerrado')),
  sessao_pty_id TEXT,
  respawn_de TEXT,
  cwd TEXT,
  encerrado_motivo TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_pane_display ON pane (workspace_id, display_id);
CREATE INDEX ix_pane_mission ON pane (mission_id);
CREATE INDEX ix_pane_workspace_estado ON pane (workspace_id, estado);
-- Invariante: no máximo 1 piloto ativo por Mission.
CREATE UNIQUE INDEX ux_pane_piloto_por_mission ON pane (mission_id) WHERE eh_piloto = 1 AND estado <> 'encerrado';

CREATE TABLE sessao (
  id TEXT PRIMARY KEY,
  pane_id TEXT NOT NULL REFERENCES pane(id) ON DELETE CASCADE,
  cli_ref_conversa TEXT,
  ultimo_uso_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_sessao_pane ON sessao (pane_id, ultimo_uso_em DESC);

CREATE TABLE task (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
  task_ref TEXT NOT NULL,
  titulo TEXT NOT NULL,
  briefing_path TEXT,
  papel TEXT NOT NULL CHECK (papel IN ('piloto','executor','explorador','revisor','nenhum')),
  estado TEXT NOT NULL CHECK (estado IN ('aberta','reivindicada','entregue','validada','descartada')),
  pane_id TEXT REFERENCES pane(id) ON DELETE SET NULL,
  handoff_id TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_task_ref ON task (mission_id, task_ref);
CREATE INDEX ix_task_mission_estado ON task (mission_id, estado);
CREATE INDEX ix_task_pane ON task (pane_id);

CREATE TABLE handoff (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  de_pane_id TEXT REFERENCES pane(id) ON DELETE SET NULL,
  para_pane_id TEXT REFERENCES pane(id) ON DELETE SET NULL,
  resumo TEXT NOT NULL CHECK (length(resumo) <= 400),
  relatorio_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok','parcial','bloqueado','falhou')),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_handoff_task ON handoff (task_id);

CREATE TABLE evento_dominio (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
-- Consulta quente (P-14): últimos eventos de um tipo; e varredura de retenção por data.
CREATE INDEX ix_evento_tipo_criado ON evento_dominio (tipo, criado_em DESC);
CREATE INDEX ix_evento_criado ON evento_dominio (criado_em);

CREATE TABLE layout (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  json TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_layout_workspace ON layout (workspace_id);

CREATE TABLE config (
  chave TEXT PRIMARY KEY,
  valor_json TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Contadores persistidos (ex.: display_id de pane). Nunca decrementam nem são apagados com as linhas.
CREATE TABLE sequencia (
  chave TEXT PRIMARY KEY,
  valor INTEGER NOT NULL
);
`;

export const migracao0001: Migracao = {
  versao: 1,
  nome: "0001-base",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
