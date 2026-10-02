import type { Migracao } from "../migrar";

// Fase 18 (T-18.02): gestão ágil. Tabelas `agil_*` conforme docs/ade/fase-18-gestao-agil.md e os ajustes de docs/ade/pedidos/18-pedidos.md.
// Regras: ids ULID com prefixo; momentos UTC ISO com ms; datas de sprint AAAA-MM-DD; booleano = INTEGER 0/1; desconhecido = NULL (nunca 0).
// `agil_fato_task` e `agil_metrica_snapshot` são cache derivado e descartável (reindexável a partir do método); o resto é decisão do usuário.
// Só texto humano JÁ redigido (`redigirSegredos`) entra em `agil_auditoria`/`motivo`. Nada aqui guarda código-fonte, caminho absoluto nem segredo.
// CASCADE por workspace nas tabelas-raiz; filhas seguem o pai. Referências "moles" (membro, épico) não têm FK: o validador do IPC garante o dono do id.
const SQL = `
CREATE TABLE agil_config (
  workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  json TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE agil_membro (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('humano','agente')),
  rotulo TEXT NOT NULL,
  agente_id TEXT,
  squad_id TEXT,
  horas_dia REAL,
  fator_foco REAL NOT NULL DEFAULT 0.6,
  pontos_sprint_fixo REAL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_agil_membro_ws ON agil_membro (workspace_id);
-- alias de agente/sessão/e-mail/login: único POR MEMBRO (o mesmo nome de agente pode existir em outro workspace).
CREATE TABLE agil_membro_alias (
  membro_id TEXT NOT NULL REFERENCES agil_membro(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('agente','sessao','email','login')),
  valor TEXT NOT NULL,
  PRIMARY KEY (membro_id, tipo, valor)
);

CREATE TABLE agil_epico (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descricao TEXT,
  cor_token TEXT,
  estado TEXT NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto','concluido','arquivado')),
  ordem REAL NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_agil_epico_ws ON agil_epico (workspace_id, ordem);

CREATE TABLE agil_item (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  origem TEXT NOT NULL CHECK (origem IN ('ade','metodo','issue','retro','ocorrencia')),
  trabalho_id TEXT,
  task_ref TEXT,
  epico_id TEXT,
  titulo TEXT NOT NULL,
  descricao TEXT,
  criterios_json TEXT NOT NULL DEFAULT '[]',
  estado_ade TEXT NOT NULL DEFAULT 'backlog' CHECK (estado_ade IN ('backlog','refinado','pronto','descartado')),
  valor REAL,
  urgencia REAL,
  reducao_risco REAL,
  moscow TEXT CHECK (moscow IN ('must','should','could','wont')),
  ordem REAL NOT NULL,
  dono_membro_id TEXT,
  par_membro_id TEXT,
  visibilidade_cliente TEXT NOT NULL DEFAULT 'auto' CHECK (visibilidade_cliente IN ('auto','sim','nao')),
  resumo_cliente TEXT,
  resumo_cliente_origem TEXT CHECK (resumo_cliente_origem = 'humano'),
  changelog_tipo TEXT CHECK (changelog_tipo IN ('added','changed','deprecated','removed','fixed','security')),
  origem_ref_json TEXT,
  descartado_motivo TEXT,
  orfao INTEGER NOT NULL DEFAULT 0 CHECK (orfao IN (0,1)),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_agil_item_ordem ON agil_item (workspace_id, estado_ade, ordem);
CREATE INDEX ix_agil_item_task ON agil_item (workspace_id, trabalho_id, task_ref) WHERE task_ref IS NOT NULL;

CREATE TABLE agil_estimativa (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES agil_item(id) ON DELETE CASCADE,
  versao INTEGER NOT NULL,
  pontos REAL,
  rotulo TEXT,
  escala_id TEXT NOT NULL,
  min_h REAL,
  max_h REAL,
  origem TEXT NOT NULL CHECK (origem IN ('ia','humano')),
  motor TEXT NOT NULL CHECK (motor IN ('heuristica','similaridade','llm','agente','manual','f35')),
  confianca REAL,
  fatores_json TEXT NOT NULL DEFAULT '[]',
  estado TEXT NOT NULL CHECK (estado IN ('sugerida','aceita','ajustada','travada')),
  ativa INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0,1)),
  nota TEXT,
  criado_em TEXT NOT NULL,
  UNIQUE (item_id, versao)
);
CREATE INDEX ix_agil_estimativa_item ON agil_estimativa (item_id, ativa);

CREATE TABLE agil_classificacao (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES agil_item(id) ON DELETE CASCADE,
  versao INTEGER NOT NULL,
  categoria TEXT NOT NULL,
  risco TEXT NOT NULL CHECK (risco IN ('baixo','medio','alto','critico')),
  criticidade TEXT NOT NULL CHECK (criticidade IN ('baixa','media','alta','critica')),
  tipo_task TEXT,
  risco_fatores_json TEXT NOT NULL DEFAULT '[]',
  origem TEXT NOT NULL CHECK (origem IN ('ia','humano')),
  motor TEXT NOT NULL,
  confianca REAL,
  estado TEXT NOT NULL CHECK (estado IN ('sugerida','aceita','ajustada','travada')),
  ativa INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0,1)),
  criado_em TEXT NOT NULL,
  UNIQUE (item_id, versao)
);
CREATE INDEX ix_agil_classificacao_item ON agil_classificacao (item_id, ativa);

CREATE TABLE agil_sprint (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  meta TEXT,
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'planejada' CHECK (estado IN ('planejada','ativa','fechada','cancelada')),
  capacidade_pontos REAL,
  compromisso_pontos REAL,
  iniciada_em TEXT,
  fechada_em TEXT,
  versao_lancamento TEXT,
  resumo_fechamento_json TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_agil_sprint_ws ON agil_sprint (workspace_id, inicio);

CREATE TABLE agil_sprint_item (
  sprint_id TEXT NOT NULL REFERENCES agil_sprint(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES agil_item(id) ON DELETE CASCADE,
  adicionado_em TEXT NOT NULL,
  removido_em TEXT,
  pontos_compromisso REAL,
  no_compromisso_inicial INTEGER NOT NULL DEFAULT 0 CHECK (no_compromisso_inicial IN (0,1)),
  motivo TEXT,
  resultado TEXT CHECK (resultado IN ('concluido','carregado','devolvido','descartado')),
  PRIMARY KEY (sprint_id, item_id)
);
CREATE INDEX ix_agil_sprint_item_item ON agil_sprint_item (item_id);

-- pontos NULL = sem base (nunca 0).
CREATE TABLE agil_capacidade (
  sprint_id TEXT NOT NULL REFERENCES agil_sprint(id) ON DELETE CASCADE,
  membro_id TEXT NOT NULL,
  dias_uteis REAL NOT NULL,
  ausencias_dias REAL NOT NULL DEFAULT 0,
  pontos REAL,
  base TEXT NOT NULL CHECK (base IN ('horas','mediana_3','fixo','sem_base')),
  PRIMARY KEY (sprint_id, membro_id)
);

CREATE TABLE agil_cerimonia (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  sprint_id TEXT REFERENCES agil_sprint(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('planejamento','daily','review','retro','refinamento')),
  data TEXT NOT NULL,
  formato TEXT,
  conteudo_json TEXT NOT NULL,
  gerada_de_fatos_em TEXT,
  editada INTEGER NOT NULL DEFAULT 0 CHECK (editada IN (0,1)),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_agil_cerimonia_ws ON agil_cerimonia (workspace_id, tipo, data);

CREATE TABLE agil_retro_item (
  id TEXT PRIMARY KEY,
  cerimonia_id TEXT NOT NULL REFERENCES agil_cerimonia(id) ON DELETE CASCADE,
  coluna TEXT NOT NULL,
  texto TEXT NOT NULL,
  votos INTEGER NOT NULL DEFAULT 0,
  dado_json TEXT,
  autor_membro_id TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_agil_retro_item_cer ON agil_retro_item (cerimonia_id);

CREATE TABLE agil_retro_acao (
  id TEXT PRIMARY KEY,
  cerimonia_id TEXT NOT NULL REFERENCES agil_cerimonia(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  dono_membro_id TEXT,
  prazo TEXT,
  estado TEXT NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta','feita','cancelada')),
  item_id TEXT,
  concluida_em TEXT,
  criado_em TEXT NOT NULL,
  vencida_notificada INTEGER NOT NULL DEFAULT 0 CHECK (vencida_notificada IN (0,1))
);
CREATE INDEX ix_agil_retro_acao_cer ON agil_retro_acao (cerimonia_id);

-- cache derivado do método (reindexável); ver docs/ade/pedidos/18-pedidos.md para as colunas acrescentadas.
CREATE TABLE agil_fato_task (
  workspace_id TEXT NOT NULL,
  trabalho_id TEXT NOT NULL,
  task_ref TEXT NOT NULL,
  titulo TEXT NOT NULL,
  fase TEXT,
  depende_de_json TEXT NOT NULL DEFAULT '[]',
  criterio_aceite TEXT,
  tipo_task TEXT,
  status_visto TEXT NOT NULL,
  iniciada_em TEXT,
  concluida_em TEXT,
  concluida_ts_precisa INTEGER CHECK (concluida_ts_precisa IN (0,1)),
  duracao_obs_ms INTEGER,
  bloqueada_ms INTEGER,
  reaberturas INTEGER NOT NULL DEFAULT 0,
  reabertas_em_json TEXT NOT NULL DEFAULT '[]',
  retrabalho_ms INTEGER,
  qa_reprovacoes INTEGER NOT NULL DEFAULT 0,
  suite_final TEXT,
  agente TEXT,
  membro_id TEXT,
  arquivos_json TEXT NOT NULL DEFAULT '[]',
  tdd_primeiro INTEGER CHECK (tdd_primeiro IN (0,1)),
  vermelho_antes INTEGER CHECK (vermelho_antes IN (0,1)),
  commits_json TEXT NOT NULL DEFAULT '[]',
  validada_em TEXT,
  tem_rastro INTEGER NOT NULL DEFAULT 0 CHECK (tem_rastro IN (0,1)),
  intervalos_json TEXT NOT NULL DEFAULT '[]',
  primeiro_evento_em TEXT,
  declarados_json TEXT NOT NULL,
  versao_origem TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (workspace_id, trabalho_id, task_ref)
);
CREATE INDEX ix_agil_fato_trab ON agil_fato_task (workspace_id, trabalho_id);

CREATE TABLE agil_versao_trabalho (
  workspace_id TEXT NOT NULL,
  trabalho_id TEXT NOT NULL,
  versao_origem TEXT NOT NULL,
  PRIMARY KEY (workspace_id, trabalho_id)
);

CREATE TABLE agil_retrabalho_evento (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  trabalho_id TEXT NOT NULL,
  task_ref TEXT,
  item_id TEXT,
  fonte TEXT NOT NULL CHECK (fonte IN ('qa_reprovado','task_reaberta','commit_fix','regressao','regra_repetida','manual')),
  forca TEXT NOT NULL CHECK (forca IN ('forte','fraca')),
  natureza TEXT NOT NULL CHECK (natureza IN ('defeito','escopo','ruido','pendente')),
  evidencia_json TEXT NOT NULL,
  chave_dedupe TEXT NOT NULL,
  ocorrido_em TEXT,
  detectado_em TEXT NOT NULL,
  confirmado_por TEXT CHECK (confirmado_por IN ('automatico','humano')),
  motivo TEXT,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);
-- a chave de deduplicação vale POR workspace (dois clones do mesmo repositório têm os mesmos nomes de trabalho e task).
CREATE UNIQUE INDEX ux_agil_retrabalho_evento_chave ON agil_retrabalho_evento (workspace_id, chave_dedupe);
CREATE INDEX ix_agil_retrabalho_evento_ws ON agil_retrabalho_evento (workspace_id, trabalho_id);

-- situacao NULL = task ainda não concluída e sem evento.
CREATE TABLE agil_retrabalho_task (
  workspace_id TEXT NOT NULL,
  trabalho_id TEXT NOT NULL,
  task_ref TEXT NOT NULL,
  situacao TEXT CHECK (situacao IN ('primeira','retrabalho','em_observacao','indeterminado')),
  eventos_defeito INTEGER NOT NULL DEFAULT 0,
  eventos_pendentes INTEGER NOT NULL DEFAULT 0,
  janela_ate TEXT,
  calculado_em TEXT NOT NULL,
  PRIMARY KEY (workspace_id, trabalho_id, task_ref)
);

-- razao, ref_ms_por_ponto e observado_ms NULL permitidos (categoria < 5 amostras; sem duração observada).
CREATE TABLE agil_erro_estimativa (
  item_id TEXT PRIMARY KEY REFERENCES agil_item(id) ON DELETE CASCADE,
  estimativa_id TEXT NOT NULL,
  pontos_previstos REAL NOT NULL,
  categoria TEXT,
  observado_ms INTEGER,
  real_h REAL,
  ref_ms_por_ponto REAL,
  razao REAL,
  registrado_em TEXT NOT NULL
);

CREATE TABLE agil_metrica_snapshot (
  workspace_id TEXT NOT NULL,
  escopo TEXT NOT NULL CHECK (escopo IN ('workspace','sprint','membro','squad')),
  chave TEXT NOT NULL,
  dia TEXT NOT NULL,
  metrica TEXT NOT NULL,
  valor REAL,
  PRIMARY KEY (workspace_id, escopo, chave, dia, metrica)
);

CREATE TABLE agil_checklist (
  sprint_id TEXT NOT NULL REFERENCES agil_sprint(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  grupo TEXT NOT NULL CHECK (grupo IN ('xp','lean','dod','dor')),
  estado TEXT NOT NULL CHECK (estado IN ('ok','atencao','falha','na','indeterminado')),
  fonte TEXT NOT NULL CHECK (fonte IN ('auto','manual')),
  valor_json TEXT,
  nota TEXT,
  PRIMARY KEY (sprint_id, codigo)
);

CREATE TABLE agil_dod_resultado (
  item_id TEXT NOT NULL REFERENCES agil_item(id) ON DELETE CASCADE,
  criterio TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('ok','falha','na','indeterminado')),
  fonte TEXT NOT NULL CHECK (fonte IN ('auto','manual')),
  em TEXT NOT NULL,
  PRIMARY KEY (item_id, criterio)
);

CREATE TABLE agil_demo (
  sprint_id TEXT NOT NULL REFERENCES agil_sprint(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  resultado TEXT NOT NULL CHECK (resultado IN ('aceito','ajustar','rejeitado')),
  nota TEXT,
  em TEXT,
  PRIMARY KEY (sprint_id, item_id)
);

-- barramento persistido: idempotência ("sprint.fechada" já publicada) e trilha para as Fases 19/20.
CREATE TABLE agil_evento (
  seq INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  sprint_id TEXT,
  trabalho_id TEXT,
  task_ref TEXT,
  pontos REAL,
  duracao_observada_ms INTEGER,
  tokens INTEGER,
  quando TEXT NOT NULL,
  dados_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_agil_evento_tipo ON agil_evento (tipo, sprint_id);
CREATE INDEX ix_agil_evento_ws ON agil_evento (workspace_id, seq);

-- só texto humano já redigido.
CREATE TABLE agil_auditoria (
  seq INTEGER PRIMARY KEY,
  acao TEXT NOT NULL,
  ator TEXT NOT NULL CHECK (ator IN ('humano','agente','sistema')),
  workspace_id TEXT NOT NULL,
  alvo TEXT NOT NULL,
  motivo TEXT,
  quando TEXT NOT NULL
);
CREATE INDEX ix_agil_auditoria_ws ON agil_auditoria (workspace_id, seq);

CREATE TABLE agil_chamada_ia (
  workspace_id TEXT NOT NULL,
  dia TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, dia)
);
`;

export const migracao0011: Migracao = {
  versao: 11,
  nome: "0011-agil",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
