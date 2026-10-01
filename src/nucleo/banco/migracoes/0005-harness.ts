import type { Migracao } from "../migrar";

// Fase 9 (T-09.02): harness, limites, trocas, decisões e OpenRouter. Schema de docs/ade/fase-09-harness-limites.md
// com os overrides do dono: P-28 (3 modos de troca por workspace, `max_saltos` padrão 3, troca entre provedores
// permitida, `faixa_minima_troca` configurável com 'descer_1') e P-31 (descer 1 faixa permitido).
// Datas: UTC ISO com ms. Booleano: INTEGER 0/1. Nenhuma coluna guarda segredo (a chave OpenRouter vive só no cofre).
const SQL = `
CREATE TABLE task_type (
  slug TEXT PRIMARY KEY,
  categoria TEXT NOT NULL,
  rotulo TEXT NOT NULL,
  descricao TEXT,
  embutido INTEGER NOT NULL DEFAULT 0 CHECK (embutido IN (0,1)),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE politica (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspace(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL REFERENCES task_type(slug) ON DELETE CASCADE,
  executor_json TEXT NOT NULL CHECK (json_valid(executor_json)),
  alternativas_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(alternativas_json)),
  fallback_json TEXT NOT NULL CHECK (fallback_json <> '[]' AND json_valid(fallback_json) AND json_type(fallback_json) = 'array' AND json_array_length(fallback_json) >= 1),
  skills_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skills_json)),
  agente TEXT,
  conta_fixa_id TEXT REFERENCES conta(id) ON DELETE SET NULL,
  evitar_reservadas INTEGER NOT NULL DEFAULT 1 CHECK (evitar_reservadas IN (0,1)),
  habilitada INTEGER NOT NULL DEFAULT 1 CHECK (habilitada IN (0,1)),
  atualizado_por TEXT NOT NULL CHECK (atualizado_por IN ('usuario','mcp','semente')),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_politica ON politica (COALESCE(workspace_id,''), task_type);
CREATE INDEX ix_politica_workspace ON politica (workspace_id);

CREATE TABLE harness_workspace (
  workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  nivel INTEGER NOT NULL DEFAULT 4 CHECK (nivel BETWEEN 1 AND 4),
  modo_troca TEXT CHECK (modo_troca IN ('manual','so_sugerir','automatico')),
  limiar_troca_pct INTEGER NOT NULL DEFAULT 85 CHECK (limiar_troca_pct BETWEEN 50 AND 99),
  limiar_esgotamento_pct INTEGER NOT NULL DEFAULT 100 CHECK (limiar_esgotamento_pct BETWEEN 51 AND 100),
  margem_troca_pontos INTEGER NOT NULL DEFAULT 10 CHECK (margem_troca_pontos BETWEEN 0 AND 50),
  troca_entre_provedores INTEGER NOT NULL DEFAULT 1 CHECK (troca_entre_provedores IN (0,1)),
  faixa_minima_troca TEXT NOT NULL DEFAULT 'mesma' CHECK (faixa_minima_troca IN ('mesma','descer_1','qualquer')),
  max_saltos INTEGER NOT NULL DEFAULT 3 CHECK (max_saltos BETWEEN 1 AND 6),
  espera_ponto_seguro_s INTEGER NOT NULL DEFAULT 600 CHECK (espera_ponto_seguro_s BETWEEN 30 AND 3600),
  piloto_edita_politica INTEGER NOT NULL DEFAULT 0 CHECK (piloto_edita_politica IN (0,1)),
  injetar_cofre_no_env INTEGER NOT NULL DEFAULT 0 CHECK (injetar_cofre_no_env IN (0,1)),
  atualizado_em TEXT NOT NULL,
  CHECK (limiar_troca_pct < limiar_esgotamento_pct)
);

CREATE TABLE conta_roteamento (
  conta_id TEXT PRIMARY KEY REFERENCES conta(id) ON DELETE CASCADE,
  reservada_modelos_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reservada_modelos_json)),
  reservada_papeis_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reservada_papeis_json)),
  workspaces_fixados_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(workspaces_fixados_json)),
  auth TEXT NOT NULL DEFAULT 'desconhecida' CHECK (auth IN ('ok','expirada','desconhecida')),
  em_cooldown_ate TEXT,
  teto_tokens_5h INTEGER CHECK (teto_tokens_5h IS NULL OR teto_tokens_5h > 0),
  teto_tokens_semana INTEGER CHECK (teto_tokens_semana IS NULL OR teto_tokens_semana > 0),
  atualizado_em TEXT NOT NULL
);

CREATE TABLE pane_rota (
  pane_id TEXT PRIMARY KEY REFERENCES pane(id) ON DELETE CASCADE,
  perfil_json TEXT NOT NULL CHECK (json_valid(perfil_json)),
  task_type TEXT,
  decisao_id TEXT,
  saltos INTEGER NOT NULL DEFAULT 0 CHECK (saltos >= 0),
  ultima_troca_em TEXT,
  ignorar_sugestao_ate TEXT,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE troca_log (
  id TEXT PRIMARY KEY,
  criado_em TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  mission_id TEXT,
  task_ref TEXT,
  pane_antigo_id TEXT,
  pane_novo_id TEXT,
  de_conta_id TEXT,
  para_conta_id TEXT,
  de_provedor TEXT,
  para_provedor TEXT,
  de_modelo TEXT,
  para_modelo TEXT,
  faixa TEXT,
  motivo TEXT NOT NULL CHECK (motivo IN ('consumo_alto','limite_atingido','manual')),
  modo TEXT NOT NULL CHECK (modo IN ('manual','so_sugerir','automatico')),
  tipo_troca TEXT NOT NULL CHECK (tipo_troca IN ('outra_conta','outro_provedor','faixa_inferior')),
  consumo_origem_pct REAL CHECK (consumo_origem_pct IS NULL OR consumo_origem_pct BETWEEN 0 AND 100),
  consumo_destino_pct REAL CHECK (consumo_destino_pct IS NULL OR consumo_destino_pct BETWEEN 0 AND 100),
  status TEXT NOT NULL CHECK (status IN ('sugerida','feita','ignorada','adiada','falhou')),
  adiada_por TEXT CHECK (adiada_por IS NULL OR adiada_por IN ('trabalhando','operacao_git','handoff_em_voo','pergunta_pendente')),
  decisao_id TEXT,
  recibo TEXT NOT NULL
);
CREATE INDEX ix_troca_log_criado ON troca_log (criado_em DESC);

CREATE TABLE limite_manual (
  conta_id TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  janela TEXT NOT NULL CHECK (janela IN ('five_hour','weekly','monthly')),
  usado_pct REAL NOT NULL CHECK (usado_pct BETWEEN 0 AND 100),
  reinicia_em TEXT,
  informado_em TEXT NOT NULL,
  PRIMARY KEY (conta_id, janela)
);

CREATE TABLE limite_amostra (
  conta_id TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  janela TEXT NOT NULL CHECK (janela IN ('five_hour','weekly','monthly','credit','modelo')),
  balde TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  usado_pct REAL NOT NULL CHECK (usado_pct BETWEEN 0 AND 100),
  reinicia_em TEXT,
  fonte TEXT NOT NULL,
  PRIMARY KEY (conta_id, janela, balde, ts)
) WITHOUT ROWID;
CREATE INDEX ix_limite_amostra_ts ON limite_amostra (ts);

CREATE TABLE limite_semana (
  semana_inicio TEXT NOT NULL,
  conta_id TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  janela TEXT NOT NULL CHECK (janela IN ('five_hour','weekly')),
  pico_pct REAL NOT NULL CHECK (pico_pct BETWEEN 0 AND 100),
  estourou INTEGER NOT NULL DEFAULT 0 CHECK (estourou IN (0,1)),
  estouro_precoce INTEGER NOT NULL DEFAULT 0 CHECK (estouro_precoce IN (0,1)),
  amostras INTEGER NOT NULL CHECK (amostras >= 0),
  PRIMARY KEY (semana_inicio, conta_id, janela)
);

CREATE TABLE decisao (
  id TEXT PRIMARY KEY,
  criado_em TEXT NOT NULL,
  proposito TEXT NOT NULL CHECK (proposito IN ('selecao_conta','task_type','modelo_esforco','troca','intencao')),
  workspace_id TEXT,
  mission_id TEXT,
  pane_id TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('choice','score','boolean')),
  opcoes_json TEXT NOT NULL CHECK (json_valid(opcoes_json)),
  probs_json TEXT CHECK (probs_json IS NULL OR json_valid(probs_json)),
  escolhida TEXT NOT NULL,
  confianca REAL CHECK (confianca IS NULL OR confianca BETWEEN 0 AND 1),
  fonte TEXT NOT NULL CHECK (fonte IN ('decisor','regra','politica','explicito','fallback')),
  escolha_regra TEXT,
  divergiu INTEGER NOT NULL DEFAULT 0 CHECK (divergiu IN (0,1)),
  latencia_ms INTEGER CHECK (latencia_ms IS NULL OR latencia_ms >= 0),
  custo_usd REAL CHECK (custo_usd IS NULL OR custo_usd >= 0),
  custo_origem TEXT CHECK (custo_origem IS NULL OR custo_origem IN ('resposta','tabela','informado','desconhecido')),
  decisor_json TEXT CHECK (decisor_json IS NULL OR json_valid(decisor_json)),
  resumo_enviado TEXT CHECK (resumo_enviado IS NULL OR length(resumo_enviado) <= 500),
  resumo_hash TEXT,
  skills_aplicadas INTEGER NOT NULL DEFAULT 0 CHECK (skills_aplicadas IN (0,1)),
  recibo TEXT NOT NULL
);
CREATE INDEX ix_decisao_criado ON decisao (criado_em DESC);
CREATE INDEX ix_decisao_proposito ON decisao (proposito, criado_em DESC);

CREATE TABLE decisao_agregado_dia (
  dia TEXT NOT NULL,
  proposito TEXT NOT NULL,
  consultas INTEGER NOT NULL DEFAULT 0,
  falhas INTEGER NOT NULL DEFAULT 0,
  divergencias INTEGER NOT NULL DEFAULT 0,
  custo_usd REAL,
  custo_desconhecido INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, proposito)
);

CREATE TABLE conta_openrouter (
  conta_id TEXT PRIMARY KEY REFERENCES conta(id) ON DELETE CASCADE,
  cofre_entrada_id TEXT NOT NULL,
  ultimos4 TEXT NOT NULL CHECK (length(ultimos4) <= 4),
  tipo TEXT NOT NULL DEFAULT 'desconhecido' CHECK (tipo IN ('pago','gratuito','desconhecido')),
  limite_usd REAL,
  usado_usd REAL,
  saldo_usd REAL,
  saldo_em TEXT
);

CREATE TABLE openrouter_modelo (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  contexto INTEGER,
  suporta_tools INTEGER CHECK (suporta_tools IS NULL OR suporta_tools IN (0,1)),
  modalidades_json TEXT CHECK (modalidades_json IS NULL OR json_valid(modalidades_json)),
  preco_entrada_por_mtok REAL CHECK (preco_entrada_por_mtok IS NULL OR preco_entrada_por_mtok >= 0),
  preco_saida_por_mtok REAL CHECK (preco_saida_por_mtok IS NULL OR preco_saida_por_mtok >= 0),
  habilitado INTEGER NOT NULL DEFAULT 0 CHECK (habilitado IN (0,1)),
  faixa TEXT CHECK (faixa IN ('topo','alto','medio','rapido')),
  ordem INTEGER NOT NULL DEFAULT 100,
  tipos_permitidos_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tipos_permitidos_json)),
  visto_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_or_modelo_habilitado ON openrouter_modelo (habilitado, faixa, ordem);
`;

export const migracao0005: Migracao = {
  versao: 5,
  nome: "0005-harness",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
