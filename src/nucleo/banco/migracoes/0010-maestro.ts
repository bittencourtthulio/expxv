import type { Migracao } from "../migrar";

// Fase 16 (T-16.02): Maestro. Pipelines (instância), uma linha por tentativa de etapa, configuração por etapa (global e por workspace),
// nível de rigidez por escopo, auditoria de mudança de nível e recibos de decisão. `openrouter_modelo` JÁ existe (migration 0005, Fase 9):
// o Maestro reaproveita essa tabela, não cria outra. NUNCA guarda o texto do pedido (só hash e resumo ≤ 200 já redigido) nem chave:
// o recibo registra ids do léxico, nunca o texto do usuário. Datas: UTC ISO com ms. Booleano: INTEGER 0/1.
// `pane_id` das etapas é TEXT simples (sem FK): o Pane pode ser descartado pelo usuário sem apagar o histórico do pipeline.
const SQL = `
CREATE TABLE maestro_pipeline (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  mission_id TEXT REFERENCES mission(id) ON DELETE SET NULL,
  trabalho_id TEXT,
  pipeline_id TEXT NOT NULL,
  intencao TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('proposto','executando','aguardando_humano','aguardando_usuario','aguardando_confirmacao','bloqueado_piso','bloqueado_trava','pausado','concluido','concluido_parcial','falhou','cancelado','expirado')),
  via TEXT NOT NULL CHECK (via IN ('mcp','hook','paleta','chat','issue','telegram','api','squad')),
  origem_pane_id TEXT,
  texto_hash TEXT NOT NULL,
  texto_resumo TEXT NOT NULL CHECK (length(texto_resumo) <= 400),
  nivel_base INTEGER NOT NULL CHECK (nivel_base BETWEEN 1 AND 5),
  nivel_atual INTEGER NOT NULL CHECK (nivel_atual BETWEEN 1 AND 5),
  nivel_pedido INTEGER CHECK (nivel_pedido IS NULL OR nivel_pedido BETWEEN 1 AND 5),
  executar_direto INTEGER NOT NULL DEFAULT 0 CHECK (executar_direto IN (0,1)),
  voltar_ao_padrao INTEGER NOT NULL DEFAULT 0 CHECK (voltar_ao_padrao IN (0,1)),
  override_trava INTEGER NOT NULL DEFAULT 0 CHECK (override_trava IN (0,1)),
  plano_json TEXT NOT NULL CHECK (json_valid(plano_json)),
  motivo_fim TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  concluido_em TEXT
);
CREATE INDEX ix_maestro_pipeline_ws ON maestro_pipeline (workspace_id, criado_em DESC);
CREATE INDEX ix_maestro_pipeline_ativos ON maestro_pipeline (workspace_id, estado) WHERE estado NOT IN ('concluido','concluido_parcial','falhou','cancelado','expirado');

CREATE TABLE maestro_etapa_exec (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES maestro_pipeline(id) ON DELETE CASCADE,
  etapa_id TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  tentativa INTEGER NOT NULL DEFAULT 1,
  rodada INTEGER NOT NULL DEFAULT 1,
  estado TEXT NOT NULL CHECK (estado IN ('pendente','pulada_nivel','pulada_usuario','despachando','executando','aguardando_humano','aguardando_usuario','aguardando_confirmacao','concluida','reprovada','falhou','sem_progresso')),
  pane_id TEXT,
  perfil_json TEXT CHECK (perfil_json IS NULL OR json_valid(perfil_json)),
  nivel INTEGER NOT NULL CHECK (nivel BETWEEN 1 AND 5),
  comando TEXT,
  reutilizou_pane INTEGER NOT NULL DEFAULT 0 CHECK (reutilizou_pane IN (0,1)),
  detectada_por TEXT CHECK (detectada_por IS NULL OR detectada_por IN ('disco','rastro','timeout','usuario')),
  inicio_em TEXT,
  fim_em TEXT,
  detalhe TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json))
);
CREATE INDEX ix_maestro_etapa_pipeline ON maestro_etapa_exec (pipeline_id, ordem, tentativa);
CREATE INDEX ix_maestro_etapa_fim ON maestro_etapa_exec (fim_em);

CREATE TABLE maestro_etapa_config (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspace(id) ON DELETE CASCADE,
  etapa_id TEXT NOT NULL,
  agente_id TEXT,
  cli TEXT,
  modelo TEXT,
  esforco TEXT,
  faixa TEXT CHECK (faixa IS NULL OR faixa IN ('topo','alto','medio','rapido')),
  origem_modelo TEXT NOT NULL DEFAULT 'cli' CHECK (origem_modelo IN ('cli','openrouter')),
  skills_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skills_json)),
  modo_execucao TEXT NOT NULL DEFAULT 'novo_terminal' CHECK (modo_execucao IN ('novo_terminal','reusar_terminal','confirmar','desligada')),
  atualizado_por TEXT NOT NULL CHECK (atualizado_por IN ('usuario','fabrica','importado')),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_maestro_etapa_config ON maestro_etapa_config (COALESCE(workspace_id, ''), etapa_id);

CREATE TABLE maestro_rigidez (
  escopo TEXT NOT NULL CHECK (escopo IN ('workspace','missao')),
  alvo_id TEXT NOT NULL,
  nivel INTEGER NOT NULL CHECK (nivel BETWEEN 1 AND 5),
  voltar_ao_padrao INTEGER NOT NULL DEFAULT 0 CHECK (voltar_ao_padrao IN (0,1)),
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (escopo, alvo_id)
);

CREATE TABLE maestro_rigidez_log (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  mission_id TEXT,
  pipeline_id TEXT,
  etapa_atual TEXT,
  escopo TEXT NOT NULL CHECK (escopo IN ('workspace','missao','pedido')),
  de INTEGER CHECK (de IS NULL OR de BETWEEN 1 AND 5),
  para INTEGER NOT NULL CHECK (para BETWEEN 1 AND 5),
  por TEXT NOT NULL CHECK (por IN ('usuario','sistema')),
  trava TEXT CHECK (trava IS NULL OR trava IN ('raio_alto','branch_protegida','producao')),
  justificativa TEXT,
  hooks_escritos INTEGER NOT NULL DEFAULT 0 CHECK (hooks_escritos IN (0,1)),
  arquivo_hooks TEXT
);
CREATE INDEX ix_maestro_rigidez_log_ts ON maestro_rigidez_log (ts DESC);

CREATE TABLE maestro_recibo (
  id TEXT PRIMARY KEY,
  criado_em TEXT NOT NULL,
  pipeline_id TEXT REFERENCES maestro_pipeline(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL,
  via TEXT NOT NULL,
  intencao TEXT NOT NULL,
  confianca REAL NOT NULL,
  fonte TEXT NOT NULL CHECK (fonte IN ('comando','explicito','regra','decisor','regra+decisor','fallback')),
  decididor_json TEXT NOT NULL CHECK (json_valid(decididor_json)),
  escolha_regra TEXT,
  escolha_decisor TEXT,
  divergiu INTEGER NOT NULL DEFAULT 0 CHECK (divergiu IN (0,1)),
  nivel INTEGER NOT NULL CHECK (nivel BETWEEN 1 AND 5),
  sinais_json TEXT NOT NULL CHECK (json_valid(sinais_json)),
  resumo_hash TEXT,
  resumo_enviado TEXT,
  texto TEXT NOT NULL
);
CREATE INDEX ix_maestro_recibo_criado ON maestro_recibo (criado_em DESC);
CREATE INDEX ix_maestro_recibo_pipeline ON maestro_recibo (pipeline_id);
`;

export const migracao0010: Migracao = {
  versao: 10,
  nome: "0010-maestro",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
