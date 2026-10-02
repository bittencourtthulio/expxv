import type { Migracao } from "../migrar";

// Fase 8 (T-08.04): memória por Pane/Missão/projeto/usuário. Ids `mem_<ulid>`; datas UTC ISO com ms; booleano 0/1.
// A memória guarda TEXTO já redigido (nunca segredo) e nunca caminho absoluto de propósito. FTS5 NÃO entra aqui (D-52):
// `memoria/fts.ts#garantirFts` cria a tabela virtual em runtime, dentro de try/catch (migration não pode falhar por módulo ausente).
// Ajustes das decisões das pendências: P-21 (solo e squad ligados por padrão), P-22 (retenção 365 d; 0 = sem limite),
// P-24 (escopo "squad": memória própria de cada squad, isolada das demais; anel 2).
const SQL = `
CREATE TABLE memoria_entrada (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspace(id) ON DELETE CASCADE,
  mission_id TEXT REFERENCES mission(id) ON DELETE CASCADE,
  pane_id TEXT REFERENCES pane(id) ON DELETE CASCADE,
  linhagem_id TEXT,
  squad_slug TEXT,
  escopo TEXT NOT NULL CHECK (escopo IN ('pane','missao','squad','workspace','usuario')),
  anel INTEGER NOT NULL DEFAULT 1 CHECK (anel BETWEEN 1 AND 3),
  tipo TEXT NOT NULL CHECK (tipo IN ('checkpoint','decisao','risco','evento','fato','preferencia','handoff','aprendizado','resumo')),
  conteudo TEXT NOT NULL CHECK (length(conteudo) BETWEEN 1 AND 1000),
  fonte TEXT NOT NULL CHECK (fonte IN ('sistema','agente','usuario')),
  autor_pane_id TEXT,
  importancia INTEGER NOT NULL DEFAULT 3 CHECK (importancia BETWEEN 1 AND 5),
  substitui_id TEXT,
  estado TEXT NOT NULL DEFAULT 'ativa' CHECK (estado IN ('ativa','substituida','resumida','expirada')),
  expira_em TEXT,
  redigido INTEGER NOT NULL DEFAULT 0 CHECK (redigido IN (0,1)),
  hash_conteudo TEXT NOT NULL CHECK (length(hash_conteudo) BETWEEN 32 AND 64),
  contagem INTEGER NOT NULL DEFAULT 1 CHECK (contagem >= 1),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  CHECK ((escopo = 'usuario') = (workspace_id IS NULL)),
  CHECK (escopo <> 'pane' OR linhagem_id IS NOT NULL),
  CHECK (escopo <> 'missao' OR mission_id IS NOT NULL),
  CHECK (escopo <> 'squad' OR squad_slug IS NOT NULL),
  CHECK ((escopo = 'usuario') = (anel = 3)),
  CHECK ((escopo IN ('workspace','squad')) = (anel = 2))
);
CREATE INDEX ix_mem_linhagem ON memoria_entrada (linhagem_id, tipo, estado, atualizado_em DESC);
CREATE INDEX ix_mem_missao ON memoria_entrada (mission_id, tipo, estado, importancia DESC);
CREATE INDEX ix_mem_workspace_anel ON memoria_entrada (workspace_id, anel, estado, importancia DESC);
CREATE INDEX ix_mem_squad ON memoria_entrada (workspace_id, squad_slug, estado, importancia DESC) WHERE escopo = 'squad';
CREATE INDEX ix_mem_hash ON memoria_entrada (escopo, hash_conteudo, atualizado_em DESC);
CREATE INDEX ix_mem_expira ON memoria_entrada (expira_em) WHERE expira_em IS NOT NULL;
CREATE INDEX ix_mem_estado_atualizado ON memoria_entrada (estado, atualizado_em);

CREATE TABLE memoria_config (
  workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  ativa INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0,1)),
  solo INTEGER NOT NULL DEFAULT 1 CHECK (solo IN (0,1)),
  squad INTEGER NOT NULL DEFAULT 1 CHECK (squad IN (0,1)),
  orcamento_brief_chars INTEGER NOT NULL DEFAULT 6000 CHECK (orcamento_brief_chars BETWEEN 1500 AND 20000),
  retencao_dias INTEGER NOT NULL DEFAULT 365 CHECK (retencao_dias = 0 OR retencao_dias BETWEEN 7 AND 3650),
  teto_mb INTEGER NOT NULL DEFAULT 500 CHECK (teto_mb BETWEEN 16 AND 100000),
  pacote_workers INTEGER NOT NULL DEFAULT 1 CHECK (pacote_workers IN (0,1)),
  embedding_modelo TEXT,
  atualizado_em TEXT NOT NULL
);

-- chave de desligar por Missão (P-21): ausência de linha = herda a do workspace
CREATE TABLE memoria_missao_config (
  mission_id TEXT PRIMARY KEY REFERENCES mission(id) ON DELETE CASCADE,
  ativa INTEGER NOT NULL CHECK (ativa IN (0,1)),
  atualizado_em TEXT NOT NULL
);

-- vetores OPCIONAIS da busca semântica da memória (só existem se um provedor de embedding foi escolhido; padrão: nenhum).
-- PK (entrada, modelo): modelos convivem; a consulta usa um só. Float32 little-endian.
CREATE TABLE memoria_vetor (
  entrada_id TEXT NOT NULL REFERENCES memoria_entrada(id) ON DELETE CASCADE,
  modelo TEXT NOT NULL,
  dimensao INTEGER NOT NULL CHECK (dimensao BETWEEN 8 AND 4096),
  vetor BLOB NOT NULL,
  criado_em TEXT NOT NULL,
  PRIMARY KEY (entrada_id, modelo)
) WITHOUT ROWID;

-- no máximo 1 filho vivo por Pane: o restore idempotente é garantido pelo banco, não só por lock (T-08.14).
-- Limpa antes eventuais duplicatas legadas (mantém o filho mais novo) para o índice nunca falhar a migration.
UPDATE pane SET estado = 'encerrado', encerrado_motivo = COALESCE(encerrado_motivo, 'duplicata_respawn')
 WHERE respawn_de IS NOT NULL AND estado <> 'encerrado'
   AND id NOT IN (SELECT MAX(id) FROM pane WHERE respawn_de IS NOT NULL AND estado <> 'encerrado' GROUP BY respawn_de);
CREATE UNIQUE INDEX ux_pane_respawn_vivo ON pane (respawn_de) WHERE respawn_de IS NOT NULL AND estado <> 'encerrado';
`;

export const migracao0007: Migracao = {
  versao: 7,
  nome: "0007-memoria",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
