import type { Migracao } from "../../banco/migrar";

// ATENÇÃO: `rag_vetor` NÃO é WITHOUT ROWID: linha de ~1 KB numa B-tree de índice vaza para páginas de overflow (medido: 4,7 KB/chunk
// contra ~1,2 KB como tabela comum).
// conhecimento.db (Fase 15, T-15.03): arquivo PRÓPRIO, `PRAGMA user_version` próprio. FTS5 NÃO entra aqui (D-52): `garantirFts()`
// cria por tentativa. `rag_vetor` é a fonte; qualquer índice em RAM é derivável. Sem chave estrangeira para o banco do domínio (outro arquivo).
// Datas: UTC ISO com ms. Texto SEMPRE já redigido. Caminhos SEMPRE relativos.
const SQL = `
CREATE TABLE rag_colecao (
  id TEXT PRIMARY KEY,
  escopo TEXT NOT NULL CHECK (escopo IN ('workspace','usuario','compartilhada')),
  workspace_id TEXT,
  projeto_id TEXT,
  nome TEXT NOT NULL,
  modelo_ativo TEXT NOT NULL,
  dimensao INTEGER NOT NULL,
  metrica TEXT NOT NULL DEFAULT 'cosseno',
  versao_politica INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_colecao_ws ON rag_colecao (workspace_id) WHERE escopo = 'workspace';

CREATE TABLE rag_documento (
  id TEXT PRIMARY KEY,
  colecao_id TEXT NOT NULL REFERENCES rag_colecao(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('doc','relatorio','decisao','causa_raiz','qa','handoff','task','missao','commit','pr','codigo','transcricao','chat','aprendizado','nota')),
  origem TEXT NOT NULL,
  titulo TEXT NOT NULL CHECK (length(titulo) <= 200),
  hash_conteudo TEXT NOT NULL,
  fonte TEXT NOT NULL CHECK (fonte IN ('sistema','agente','usuario')),
  mission_id TEXT, task_ref TEXT, pane_id TEXT, cli TEXT, modelo_autor TEXT, autor TEXT,
  importancia INTEGER NOT NULL DEFAULT 3 CHECK (importancia BETWEEN 1 AND 5),
  estado TEXT NOT NULL DEFAULT 'ativo' CHECK (estado IN ('ativo','substituido','resumido','esquecido')),
  expira_em TEXT,
  ocorrido_em TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (colecao_id, tipo, origem)
);
CREATE INDEX ix_doc_colecao_tipo ON rag_documento (colecao_id, tipo, estado, ocorrido_em DESC);
CREATE INDEX ix_doc_missao ON rag_documento (mission_id, tipo) WHERE mission_id IS NOT NULL;

CREATE TABLE rag_chunk (
  id TEXT PRIMARY KEY,
  documento_id TEXT NOT NULL REFERENCES rag_documento(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  texto TEXT NOT NULL CHECK (length(texto) <= 2000),
  titulos TEXT NOT NULL DEFAULT '',
  termos TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_chunk_doc ON rag_chunk (documento_id, ordem);

CREATE TABLE rag_vetor (
  chunk_id TEXT NOT NULL REFERENCES rag_chunk(id) ON DELETE CASCADE,
  modelo TEXT NOT NULL,
  dimensao INTEGER NOT NULL,
  q INTEGER NOT NULL DEFAULT 0 CHECK (q IN (0,1)),
  escala REAL,
  vetor BLOB NOT NULL,
  PRIMARY KEY (chunk_id, modelo)
);
CREATE INDEX ix_vetor_modelo ON rag_vetor (modelo);

CREATE TABLE rag_no (
  id TEXT PRIMARY KEY,
  colecao_id TEXT NOT NULL REFERENCES rag_colecao(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('arquivo','simbolo','task','missao','decisao','commit','pr','sessao','agente','aprendizado','relatorio','ocorrencia','doc')),
  chave TEXT NOT NULL,
  rotulo TEXT NOT NULL CHECK (length(rotulo) <= 120),
  props_json TEXT NOT NULL DEFAULT '{}',
  peso REAL NOT NULL DEFAULT 1,
  x REAL, y REAL,
  primeiro_em TEXT NOT NULL,
  ultimo_em TEXT NOT NULL,
  UNIQUE (colecao_id, tipo, chave)
);

CREATE TABLE rag_aresta (
  origem_id TEXT NOT NULL REFERENCES rag_no(id) ON DELETE CASCADE,
  destino_id TEXT NOT NULL REFERENCES rag_no(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('toca','implementa','corrigiu','causou','depende','citou','pertence','executou','produziu','substitui')),
  documento_id TEXT NOT NULL DEFAULT '' ,
  peso REAL NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  PRIMARY KEY (origem_id, destino_id, tipo, documento_id)
) WITHOUT ROWID;
CREATE INDEX ix_aresta_destino ON rag_aresta (destino_id, tipo);
CREATE INDEX ix_aresta_doc ON rag_aresta (documento_id) WHERE documento_id <> '';

CREATE TABLE rag_aprendizado (
  id TEXT PRIMARY KEY,
  colecao_id TEXT NOT NULL REFERENCES rag_colecao(id) ON DELETE CASCADE,
  documento_id TEXT REFERENCES rag_documento(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('decisao','causa_raiz','armadilha','padrao','correcao','fato')),
  titulo TEXT NOT NULL CHECK (length(titulo) <= 120),
  texto TEXT NOT NULL CHECK (length(texto) <= 1000),
  fonte TEXT NOT NULL CHECK (fonte IN ('sistema','agente','usuario')),
  estado TEXT NOT NULL DEFAULT 'candidato' CHECK (estado IN ('candidato','ativo','arquivado','rejeitado')),
  confianca REAL NOT NULL DEFAULT 0.5,
  hash TEXT NOT NULL,
  util INTEGER NOT NULL DEFAULT 0,
  inutil INTEGER NOT NULL DEFAULT 0,
  errado INTEGER NOT NULL DEFAULT 0,
  vezes_visto INTEGER NOT NULL DEFAULT 1,
  proveniencia_json TEXT NOT NULL,
  substitui_id TEXT,
  ultimo_uso_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_apr_colecao ON rag_aprendizado (colecao_id, estado, tipo);
CREATE UNIQUE INDEX ux_apr_hash ON rag_aprendizado (colecao_id, hash) WHERE estado IN ('candidato','ativo');

CREATE TABLE rag_feedback (
  id TEXT PRIMARY KEY,
  alvo_tipo TEXT NOT NULL CHECK (alvo_tipo IN ('chunk','documento','aprendizado')),
  alvo_id TEXT NOT NULL,
  valor TEXT NOT NULL CHECK (valor IN ('util','inutil','errado')),
  por TEXT NOT NULL CHECK (por IN ('agente','humano')),
  pane_id TEXT, consulta_id TEXT, nota TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_feedback_alvo ON rag_feedback (alvo_tipo, alvo_id);

CREATE TABLE rag_consulta (
  id TEXT PRIMARY KEY,
  colecao_id TEXT, workspace_id TEXT, mission_id TEXT, task_ref TEXT, pane_id TEXT,
  origem TEXT NOT NULL CHECK (origem IN ('tool','injecao','hook','chat','ui')),
  modo TEXT NOT NULL,
  consulta_redigida TEXT NOT NULL CHECK (length(consulta_redigida) <= 200),
  estado TEXT NOT NULL CHECK (estado IN ('ok','vazio','lento','degradado','indisponivel','desligado')),
  n_resultados INTEGER NOT NULL,
  latencia_ms INTEGER NOT NULL,
  sinais_json TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_consulta_task ON rag_consulta (mission_id, task_ref, criado_em DESC);

CREATE TABLE rag_fonte (
  id TEXT PRIMARY KEY,
  colecao_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  ref TEXT NOT NULL,
  mtime_ms INTEGER, tamanho INTEGER, hash TEXT,
  ultimo_offset INTEGER NOT NULL DEFAULT 0,
  ultimo_sha TEXT,
  atualizado_em TEXT NOT NULL,
  UNIQUE (colecao_id, tipo, ref)
);

CREATE TABLE rag_fila (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prioridade INTEGER NOT NULL DEFAULT 5,
  evento_json TEXT NOT NULL,
  tentativas INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL
);

CREATE TABLE rag_tombstone (
  colecao_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  PRIMARY KEY (colecao_id, hash)
) WITHOUT ROWID;

CREATE TABLE rag_saida (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  colecao_id TEXT NOT NULL,
  registro_id TEXT NOT NULL,
  operacao TEXT NOT NULL CHECK (operacao IN ('upsert','apagar')),
  criado_em TEXT NOT NULL,
  UNIQUE (colecao_id, registro_id, operacao)
);

CREATE TABLE rag_migracao (
  id TEXT PRIMARY KEY,
  colecao_id TEXT NOT NULL,
  provedor TEXT NOT NULL,
  host TEXT NOT NULL,
  colecao_remota TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('previa','consentida','enviando','pausada','verificando','concluida','falhou','cancelada')),
  tipos_json TEXT NOT NULL,
  total INTEGER NOT NULL,
  enviados INTEGER NOT NULL DEFAULT 0,
  cursor TEXT,
  consentimento_em TEXT,
  erro TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE rag_cache_remoto (
  chave TEXT PRIMARY KEY,
  resposta_json TEXT NOT NULL,
  expira_em TEXT NOT NULL
);
`;

export const migracaoConhecimento0001: Migracao = {
  versao: 1,
  nome: "conhecimento-0001-base",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
