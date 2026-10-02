import type { Migracao } from "../migrar";

// Fase 20 (T-20.03): Centro de Alertas + Telegram. Número 0013 (0012 = custo). Datas ISO UTC; booleano INTEGER 0/1.
// Deltas de `docs/ade/pedidos/20-pedidos.md` §1 já incorporados: `canal.tipo` aceita 'toast'; `alerta_regra.chat_ref`; `alerta_entrega.nivel/chat_ref`;
// `telegram_aprovacao.acao` ampliada + `extra`; `mensagem_entrada.texto_hash/edicoes`; índices `ix_entrada_hash` e `ix_aprov_plano`.
// A idempotência de entrega é um ÍNDICE ÚNICO sobre COALESCE(regra_id,''): em SQLite NULL não colide em UNIQUE comum.
// Nenhuma coluna guarda token/PIN em claro: só `pin_hash` (scrypt) e `nonce_hash` (sha256). Os canais (so/toast/telegram) são criados pelo main sob demanda.
const SQL = `
CREATE TABLE alerta (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  severidade TEXT NOT NULL CHECK (severidade IN ('info','sucesso','aviso','critico')),
  fonte TEXT NOT NULL,
  workspace_id TEXT, mission_id TEXT, entidade_tipo TEXT, entidade_id TEXT,
  titulo TEXT NOT NULL,
  dados_json TEXT NOT NULL,
  dedupe_chave TEXT NOT NULL,
  contagem INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  lido_em TEXT, silenciado_ate TEXT, arquivado_em TEXT
);
CREATE INDEX ix_alerta_criado ON alerta (criado_em DESC, id DESC);
CREATE INDEX ix_alerta_naolido ON alerta (lido_em, severidade, criado_em DESC);
CREATE INDEX ix_alerta_entidade ON alerta (workspace_id, entidade_tipo, entidade_id);
CREATE INDEX ix_alerta_dedupe ON alerta (dedupe_chave, criado_em DESC);

CREATE TABLE canal (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('so','toast','telegram','webhook')),
  nome TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('desligado','configurando','ativo','erro','conflito','pausado')),
  config_json TEXT NOT NULL DEFAULT '{}',
  consentimento_json TEXT,
  saida_ligada INTEGER NOT NULL DEFAULT 0 CHECK (saida_ligada IN (0,1)),
  entrada_ligada INTEGER NOT NULL DEFAULT 0 CHECK (entrada_ligada IN (0,1)),
  silenciado_ate TEXT, erro_codigo TEXT,
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
);

CREATE TABLE alerta_regra (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  ativa INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0,1)),
  tipos_json TEXT NOT NULL,
  canal_id TEXT NOT NULL REFERENCES canal(id) ON DELETE CASCADE,
  filtros_json TEXT NOT NULL DEFAULT '{}',
  silencio_json TEXT NOT NULL DEFAULT '{}',
  agrupamento_json TEXT NOT NULL DEFAULT '{"modo":"imediato"}',
  nivel TEXT NOT NULL DEFAULT 'minimo' CHECK (nivel IN ('minimo','padrao','completo')),
  efemera_ate TEXT,
  origem TEXT NOT NULL DEFAULT 'usuario' CHECK (origem IN ('usuario','padrao','pedido_remoto')),
  chat_ref TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE alerta_template (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  canal_tipo TEXT NOT NULL,
  nivel TEXT NOT NULL CHECK (nivel IN ('minimo','padrao','completo')),
  corpo TEXT NOT NULL CHECK (length(corpo) <= 2000),
  editado INTEGER NOT NULL DEFAULT 0 CHECK (editado IN (0,1)),
  atualizado_em TEXT NOT NULL,
  UNIQUE (tipo, canal_tipo, nivel)
);

CREATE TABLE alerta_entrega (
  id TEXT PRIMARY KEY,
  alerta_id TEXT NOT NULL REFERENCES alerta(id) ON DELETE CASCADE,
  canal_id TEXT NOT NULL REFERENCES canal(id) ON DELETE CASCADE,
  regra_id TEXT REFERENCES alerta_regra(id) ON DELETE SET NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendente','agrupado','enviado','falhou','descartado')),
  tentativas INTEGER NOT NULL DEFAULT 0,
  proxima_tentativa_em TEXT, erro_codigo TEXT,
  lote_id TEXT, mensagem_externa_id TEXT, enviado_em TEXT,
  criado_em TEXT NOT NULL,
  nivel TEXT NOT NULL DEFAULT 'minimo' CHECK (nivel IN ('minimo','padrao','completo')),
  chat_ref TEXT
);
CREATE UNIQUE INDEX ux_entrega_idem ON alerta_entrega (alerta_id, canal_id, COALESCE(regra_id, ''));
CREATE INDEX ix_entrega_pend ON alerta_entrega (estado, proxima_tentativa_em);

CREATE TABLE tarefa_tempo (
  workspace_id TEXT NOT NULL, trabalho_id TEXT NOT NULL, task_id TEXT NOT NULL,
  inicio TEXT NOT NULL, fim TEXT,
  ativo_ms INTEGER NOT NULL DEFAULT 0, aguardando_ms INTEGER NOT NULL DEFAULT 0,
  estado_atual TEXT, estado_desde TEXT, pane_id TEXT,
  alertou_atraso INTEGER NOT NULL DEFAULT 0 CHECK (alertou_atraso IN (0,1,2)),
  PRIMARY KEY (workspace_id, trabalho_id, task_id, inicio)
);
CREATE INDEX ix_tempo_aberta ON tarefa_tempo (fim);

CREATE TABLE telegram_estado (
  canal_id TEXT PRIMARY KEY REFERENCES canal(id) ON DELETE CASCADE,
  proximo_offset INTEGER, ultimo_update_id INTEGER,
  bot_id INTEGER, bot_username TEXT, bot_nome TEXT,
  ultimo_poll_em TEXT, ultimo_erro_codigo TEXT,
  conflitos_seguidos INTEGER NOT NULL DEFAULT 0,
  descarte_inicial_feito INTEGER NOT NULL DEFAULT 0 CHECK (descarte_inicial_feito IN (0,1))
);
CREATE TABLE telegram_update_visto (update_id INTEGER PRIMARY KEY, visto_em TEXT NOT NULL);
CREATE INDEX ix_update_visto_em ON telegram_update_visto (visto_em);

CREATE TABLE telegram_autorizado (
  id TEXT PRIMARY KEY,
  canal_id TEXT NOT NULL REFERENCES canal(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL, chat_id INTEGER NOT NULL,
  nome_exibicao TEXT NOT NULL,
  modo_padrao TEXT NOT NULL DEFAULT 'aprovar' CHECK (modo_padrao IN ('consulta','aprovar','direto')),
  texto_livre INTEGER NOT NULL DEFAULT 1 CHECK (texto_livre IN (0,1)),
  pin_hash TEXT,
  criado_em TEXT NOT NULL, ultimo_uso_em TEXT NOT NULL, expira_em TEXT NOT NULL, revogado_em TEXT,
  UNIQUE (canal_id, user_id)
);
CREATE TABLE telegram_workspace (
  autorizado_id TEXT NOT NULL REFERENCES telegram_autorizado(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  modo TEXT NOT NULL CHECK (modo IN ('consulta','aprovar','direto')),
  padrao INTEGER NOT NULL DEFAULT 0 CHECK (padrao IN (0,1)),
  PRIMARY KEY (autorizado_id, workspace_id)
);
CREATE TABLE telegram_nao_autorizado (
  user_id INTEGER PRIMARY KEY,
  primeiro_em TEXT NOT NULL, ultimo_em TEXT NOT NULL,
  contagem INTEGER NOT NULL DEFAULT 1,
  bloqueado INTEGER NOT NULL DEFAULT 0 CHECK (bloqueado IN (0,1))
);

CREATE TABLE mensagem_entrada (
  id TEXT PRIMARY KEY,
  canal_id TEXT NOT NULL, autorizado_id TEXT NOT NULL, update_id INTEGER NOT NULL,
  texto_redigido TEXT NOT NULL CHECK (length(texto_redigido) <= 2000),
  tamanho_original INTEGER NOT NULL,
  comando TEXT, intencao TEXT, plano_id TEXT, workspace_id TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('recebida','ignorada','plano_enviado','aprovada','cancelada','expirada','bloqueada','executando','concluida','falhou')),
  motivo TEXT, args_hash TEXT, mission_id TEXT, resultado_resumo TEXT,
  aprovado_em TEXT, aprovado_por TEXT,
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
  texto_hash TEXT,
  edicoes INTEGER NOT NULL DEFAULT 0 CHECK (edicoes BETWEEN 0 AND 3),
  UNIQUE (canal_id, update_id)
);
CREATE INDEX ix_entrada_hash ON mensagem_entrada (autorizado_id, texto_hash, criado_em);
CREATE INDEX ix_entrada_plano ON mensagem_entrada (plano_id);

CREATE TABLE telegram_aprovacao (
  nonce_hash TEXT PRIMARY KEY,
  mensagem_entrada_id TEXT NOT NULL REFERENCES mensagem_entrada(id) ON DELETE CASCADE,
  acao TEXT NOT NULL CHECK (acao IN ('aprovar','editar','cancelar','parar','ws','gate_aprovar','gate_recusar','gate_confirmar')),
  plano_id TEXT NOT NULL, args_hash TEXT NOT NULL,
  chat_id INTEGER NOT NULL, message_id INTEGER, user_id INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendente','usado','anulado','expirado')),
  expira_em TEXT NOT NULL, usado_em TEXT,
  extra TEXT
);
CREATE INDEX ix_aprov_plano ON telegram_aprovacao (plano_id, acao, estado);

CREATE TABLE telegram_auditoria (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  canal_id TEXT NOT NULL,
  evento TEXT NOT NULL,
  user_id INTEGER, workspace_id TEXT, plano_id TEXT, mensagem_entrada_id TEXT, args_hash TEXT,
  resultado TEXT,
  detalhe_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_tg_auditoria_ts ON telegram_auditoria (canal_id, ts DESC, id DESC);
`;

export const migracao0013: Migracao = {
  versao: 13,
  nome: "0013-alertas",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
