import type { Migracao } from "../migrar";

// Fase 10 (T-10.02): custo e board. Número 0012 (a 0011 é a da gestão ágil, Fase 18). Datas UTC ISO com ms; booleano INTEGER 0/1; moeda canônica USD.
// Tudo que é custo "desconhecido" é NULL (nunca 0). Referência de arquivo de transcript é `base + relativo` (D-109), nunca caminho absoluto.
// Desvios deliberados do plano: (1) `uso_fonte.base` aceita também 'nenhuma' (CLI sem leitor de uso: `estado='sem_fonte'`); (2) `preco_modelo` ganha `fonte`/`coletado_em`
// (preço sem procedência não entra na tabela); (3) `custo_alerta` deduplica alertas (teto, preço ausente, fonte ausente) entre reinícios; (4) `task.reivindicada_em`/`entregue_em`
// são gravados por TRIGGER sobre a transição de `estado` (não muda a API do repositório de task, que pertence a outra área).
const SQL = `
ALTER TABLE task ADD COLUMN reivindicada_em TEXT;
ALTER TABLE task ADD COLUMN entregue_em TEXT;

CREATE TRIGGER tg_task_reivindicada AFTER UPDATE OF estado ON task
WHEN NEW.estado = 'reivindicada' AND OLD.estado <> 'reivindicada'
BEGIN
  UPDATE task SET reivindicada_em = strftime('%Y-%m-%dT%H:%M:%fZ','now'), entregue_em = NULL WHERE id = NEW.id;
END;
CREATE TRIGGER tg_task_entregue AFTER UPDATE OF estado ON task
WHEN NEW.estado = 'entregue' AND OLD.estado <> 'entregue'
BEGIN
  UPDATE task SET entregue_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TABLE preco_modelo (
  id TEXT PRIMARY KEY,
  padrao TEXT NOT NULL,
  familia TEXT,
  entrada_por_mtok REAL NOT NULL CHECK (entrada_por_mtok >= 0),
  saida_por_mtok REAL NOT NULL CHECK (saida_por_mtok >= 0),
  cache_escrita_por_mtok REAL CHECK (cache_escrita_por_mtok IS NULL OR cache_escrita_por_mtok >= 0),
  cache_leitura_por_mtok REAL CHECK (cache_leitura_por_mtok IS NULL OR cache_leitura_por_mtok >= 0),
  moeda TEXT NOT NULL DEFAULT 'USD' CHECK (moeda = 'USD'),
  origem TEXT NOT NULL CHECK (origem IN ('embutido','usuario','openrouter')),
  confirmado INTEGER NOT NULL DEFAULT 0 CHECK (confirmado IN (0,1)),
  valido_desde TEXT NOT NULL,
  fonte TEXT,
  coletado_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_preco_padrao ON preco_modelo (padrao, valido_desde DESC);
CREATE UNIQUE INDEX ux_preco_origem_padrao ON preco_modelo (origem, padrao, valido_desde);

CREATE TABLE uso_fonte (
  id TEXT PRIMARY KEY,
  cli TEXT NOT NULL,
  conta_id TEXT REFERENCES conta(id) ON DELETE SET NULL,
  pane_id TEXT REFERENCES pane(id) ON DELETE SET NULL,
  mission_id TEXT,
  workspace_id TEXT,
  base TEXT NOT NULL CHECK (base IN ('claude_config','codex_home','proxy','nenhuma')),
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
CREATE UNIQUE INDEX ux_uso_fonte ON uso_fonte (base, COALESCE(conta_id,''), relativo) WHERE relativo <> '';
CREATE UNIQUE INDEX ux_uso_fonte_pane ON uso_fonte (pane_id, base) WHERE relativo = '' AND pane_id IS NOT NULL;
CREATE INDEX ix_uso_fonte_pane ON uso_fonte (pane_id);

CREATE TABLE uso_registro (
  id TEXT PRIMARY KEY,
  fonte_id TEXT NOT NULL REFERENCES uso_fonte(id) ON DELETE CASCADE,
  chave TEXT NOT NULL,
  ts TEXT NOT NULL,
  modelo TEXT,
  tokens_entrada INTEGER NOT NULL DEFAULT 0,
  tokens_cache_escrita INTEGER NOT NULL DEFAULT 0,
  tokens_cache_leitura INTEGER NOT NULL DEFAULT 0,
  tokens_saida INTEGER NOT NULL DEFAULT 0,
  usd REAL,
  usd_origem TEXT NOT NULL CHECK (usd_origem IN ('cli','proxy','tabela','desconhecido')),
  preco_id TEXT,
  aproximado INTEGER NOT NULL DEFAULT 0 CHECK (aproximado IN (0,1)),
  pane_id TEXT,
  mission_id TEXT,
  workspace_id TEXT,
  conta_id TEXT,
  trabalho_id TEXT,
  task_id TEXT,
  atribuicao TEXT NOT NULL CHECK (atribuicao IN ('card','orquestracao','sem_card','ambigua')),
  UNIQUE (fonte_id, chave)
);
CREATE INDEX ix_uso_pane_ts ON uso_registro (pane_id, ts);
CREATE INDEX ix_uso_card ON uso_registro (workspace_id, trabalho_id, task_id) WHERE task_id IS NOT NULL;

CREATE TABLE janela_task (
  workspace_id TEXT NOT NULL,
  trabalho_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('banco','rastro')),
  pane_id TEXT,
  cwd_rel TEXT,
  inicio TEXT NOT NULL,
  fim TEXT,
  PRIMARY KEY (workspace_id, trabalho_id, task_id, origem, inicio)
);
CREATE INDEX ix_janela_pane ON janela_task (pane_id, inicio);

CREATE TABLE custo_agregado (
  escopo TEXT NOT NULL CHECK (escopo IN ('card','missao','trabalho','workspace','conta','pane')),
  chave TEXT NOT NULL,
  dia TEXT NOT NULL,
  modelo TEXT NOT NULL DEFAULT '',
  atribuicao TEXT NOT NULL DEFAULT 'card' CHECK (atribuicao IN ('card','orquestracao','sem_card','ambigua')),
  registros INTEGER NOT NULL DEFAULT 0,
  registros_sem_preco INTEGER NOT NULL DEFAULT 0,
  registros_aproximados INTEGER NOT NULL DEFAULT 0,
  tokens_entrada INTEGER NOT NULL DEFAULT 0,
  tokens_cache_escrita INTEGER NOT NULL DEFAULT 0,
  tokens_cache_leitura INTEGER NOT NULL DEFAULT 0,
  tokens_saida INTEGER NOT NULL DEFAULT 0,
  usd_conhecido REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (escopo, chave, dia, modelo, atribuicao)
) WITHOUT ROWID;
CREATE INDEX ix_custo_agregado_dia ON custo_agregado (escopo, dia);

CREATE TABLE custo_teto (
  mission_id TEXT PRIMARY KEY REFERENCES mission(id) ON DELETE CASCADE,
  teto_usd REAL NOT NULL CHECK (teto_usd > 0),
  alertado_em TEXT
);

CREATE TABLE custo_alerta (
  tipo TEXT NOT NULL CHECK (tipo IN ('teto_missao','aviso_teto_missao','preco_ausente','fonte_ausente')),
  alvo TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  PRIMARY KEY (tipo, alvo)
) WITHOUT ROWID;
`;

export const migracao0012: Migracao = {
  versao: 12,
  nome: "0012-custo",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
