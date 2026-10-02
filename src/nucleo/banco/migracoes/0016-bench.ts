import type { Migracao } from "../migrar";

// Fase 12 (T-12.01): Bench. Número 0016 (0015 = uso-fonte-opencode). Ids ULID com prefixo (`btar_`, `balv_`, `brun_`, `bres_`, `bjul_`); momentos UTC ISO com ms; booleano INTEGER 0/1;
// desconhecido = NULL (custo NUNCA vira 0 por falta de dado). Tabelas globais do app (o Bench não é de um workspace). Desvio do plano registrado em D-70: o plano previa um `bench.db` separado;
// por ordem do coordenador as tabelas moram no banco principal (uma só migração, um só backup). O log de cada execução NÃO mora aqui: fica em arquivo sob `<userData>/bench/exec/…`
// (caminho RELATIVO em `workdir`/`log_ref`). Invariantes por CONSTRAINT: no máximo um resultado não `substituido` por (run, tarefa, alvo); `qualidade` só existe com `juiz_estado ∈ {feito, manual}`.
const SQL = `
CREATE TABLE bench_tarefa (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  versao INTEGER NOT NULL CHECK (versao >= 1),
  titulo TEXT NOT NULL,
  atividade TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('web','codigo','analise')),
  prompt TEXT NOT NULL,
  escopo TEXT NOT NULL DEFAULT '',
  checagens_json TEXT NOT NULL DEFAULT '[]',
  rubrica_json TEXT NOT NULL DEFAULT '[]',
  estado TEXT NOT NULL CHECK (estado IN ('rascunho','ativa','aposentada')),
  origem TEXT NOT NULL CHECK (origem IN ('observada_literal','observada_parafrase','autoral')),
  tem_fixture INTEGER NOT NULL DEFAULT 0 CHECK (tem_fixture IN (0,1)),
  embutida INTEGER NOT NULL DEFAULT 0 CHECK (embutida IN (0,1)),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_bench_tarefa_atividade ON bench_tarefa (atividade, estado);

CREATE TABLE bench_alvo (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  provedor TEXT NOT NULL,
  modelo TEXT NOT NULL,
  esforco TEXT,
  cli TEXT NOT NULL CHECK (cli IN ('claude','codex')),
  conta_id TEXT,
  rotulo TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

CREATE TABLE bench_preco (
  provedor TEXT NOT NULL,
  modelo TEXT NOT NULL,
  preco_in_mtok REAL NOT NULL CHECK (preco_in_mtok >= 0),
  preco_out_mtok REAL NOT NULL CHECK (preco_out_mtok >= 0),
  preco_cache_mtok REAL CHECK (preco_cache_mtok IS NULL OR preco_cache_mtok >= 0),
  vale_desde TEXT NOT NULL,
  PRIMARY KEY (provedor, modelo)
);

CREATE TABLE bench_run (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  tarefas_json TEXT NOT NULL,
  alvos_json TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('enfileirada','executando','julgando','concluida','parcial','cancelada','interrompida')),
  max_paralelo INTEGER NOT NULL CHECK (max_paralelo BETWEEN 1 AND 5),
  teto_usd REAL CHECK (teto_usd IS NULL OR teto_usd >= 0),
  juiz_alvo TEXT,
  pesos_json TEXT NOT NULL,
  sandbox TEXT NOT NULL CHECK (sandbox IN ('macos','nativo_cli','nenhum')),
  criado_em TEXT NOT NULL,
  iniciada_em TEXT,
  terminada_em TEXT
);
CREATE INDEX ix_bench_run_criado ON bench_run (criado_em, id);

CREATE TABLE bench_resultado (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES bench_run(id) ON DELETE CASCADE,
  tarefa_slug TEXT NOT NULL,
  tarefa_versao INTEGER NOT NULL,
  alvo_slug TEXT NOT NULL,
  tentativa INTEGER NOT NULL DEFAULT 1 CHECK (tentativa >= 1),
  estado TEXT NOT NULL CHECK (estado IN ('enfileirado','executando','concluido','falhou','tempo_esgotado','cancelado','interrompido','substituido')),
  workdir TEXT,
  log_ref TEXT,
  prompt_efetivo TEXT NOT NULL DEFAULT '',
  duracao_s REAL,
  custo_usd REAL CHECK (custo_usd IS NULL OR custo_usd >= 0),
  custo_fonte TEXT NOT NULL DEFAULT 'desconhecido' CHECK (custo_fonte IN ('relatorio_cli','tabela_precos','desconhecido')),
  custo_tipo TEXT CHECK (custo_tipo IS NULL OR custo_tipo IN ('medido','equivalente_api')),
  preco_json TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  tokens_total INTEGER,
  turnos INTEGER,
  revisoes INTEGER,
  artefatos_json TEXT NOT NULL DEFAULT '[]',
  checagens_json TEXT NOT NULL DEFAULT '[]',
  isolamento TEXT NOT NULL DEFAULT 'parcial' CHECK (isolamento IN ('garantido','parcial')),
  juiz_estado TEXT NOT NULL DEFAULT 'pendente' CHECK (juiz_estado IN ('pendente','feito','erro','manual')),
  qualidade REAL CHECK (qualidade IS NULL OR (qualidade >= 0 AND qualidade <= 10)),
  qualidade_detalhe_json TEXT,
  notas TEXT,
  aviso TEXT,
  cli_versao TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  CHECK (qualidade IS NULL OR juiz_estado IN ('feito','manual')),
  CHECK (custo_fonte <> 'desconhecido' OR custo_usd IS NULL)
);
CREATE UNIQUE INDEX ux_bench_resultado_par ON bench_resultado (run_id, tarefa_slug, alvo_slug) WHERE estado <> 'substituido';
CREATE INDEX ix_bench_resultado_run ON bench_resultado (run_id, tarefa_slug, alvo_slug);
CREATE INDEX ix_bench_resultado_alvo ON bench_resultado (alvo_slug, tarefa_slug, tarefa_versao);

CREATE TABLE bench_veredito (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES bench_run(id) ON DELETE CASCADE,
  tarefa_slug TEXT NOT NULL,
  tarefa_versao INTEGER NOT NULL,
  juiz_modelo TEXT NOT NULL,
  mapa_cego_json TEXT NOT NULL,
  notas_json TEXT NOT NULL,
  ranking_json TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_bench_veredito_run ON bench_veredito (run_id, tarefa_slug);
`;

export const migracao0016: Migracao = {
  versao: 16,
  nome: "0016-bench",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
