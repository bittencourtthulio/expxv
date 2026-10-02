import type { Migracao } from "../migrar";

// Fase 7 (catálogo) + Fase 7C (gateway MCP). Número 0018 (0017 = jarvis-remoto). Prefixos do catálogo: `catalogo_item/instalacao/mcp_tool/politica/
// pane_politica/embarcada/varredura` (as da Loja de MCPs são `catalogo_mcp_*` da 0008 e NÃO se tocam). Datas UTC ISO com ms; booleano 0/1; caminhos
// RELATIVOS a `base` (home|workspace), nunca absolutos. Só METADADO: nada de `env`/headers/args/texto de comando de MCP ou de hook (redação na origem).
// Gateway: `gateway_pane` guarda o SNAPSHOT do Pane (quais servidores/papel; nunca segredo nem token) para que um Pane que sobreviveu ao restart do app
// (daemon vivo) recupere o acesso (R-3 da AUDITORIA-LOJA-MCP) — o segredo HMAC do token já é persistente (`<userData>/mcp-segredo`, 0600).
const SQL = `
CREATE TABLE catalogo_item (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('skill','agent','command','mcp_server','mcp_tool','plugin','hook','rule')),
  nome TEXT NOT NULL,
  nome_normalizado TEXT NOT NULL,
  plugin TEXT,
  autor TEXT,
  origem TEXT NOT NULL CHECK (origem IN ('usuario','terceiro','embarcada','nativa','metodo')),
  descricao TEXT,
  papel_sugerido TEXT CHECK (papel_sugerido IS NULL OR papel_sugerido IN ('explorador','executor','revisor')),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_catalogo_item ON catalogo_item (tipo, nome_normalizado);

CREATE TABLE catalogo_instalacao (
  item_id TEXT NOT NULL REFERENCES catalogo_item(id) ON DELETE CASCADE,
  cli TEXT NOT NULL CHECK (cli IN ('claude','codex','opencode','gemini','portatil')),
  escopo TEXT NOT NULL CHECK (escopo IN ('global','projeto')),
  workspace_id TEXT NOT NULL DEFAULT '',
  base TEXT NOT NULL CHECK (base IN ('home','workspace')),
  caminho_rel TEXT NOT NULL,
  metodo TEXT NOT NULL CHECK (metodo IN ('nativo','symlink','copia')),
  estado TEXT NOT NULL CHECK (estado IN ('presente','ausente','quebrado')),
  habilitada INTEGER NOT NULL DEFAULT 1 CHECK (habilitada IN (0,1)),
  criado_pelo_app INTEGER NOT NULL DEFAULT 0 CHECK (criado_pelo_app IN (0,1)),
  hash_conteudo TEXT,
  tamanho INTEGER,
  mtime_ms INTEGER,
  detalhe_json TEXT NOT NULL DEFAULT '{}',
  visto_em TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (item_id, cli, escopo, workspace_id)
) WITHOUT ROWID;
CREATE INDEX ix_catalogo_inst_estado ON catalogo_instalacao (estado);
CREATE INDEX ix_catalogo_inst_ws ON catalogo_instalacao (workspace_id, cli);

CREATE TABLE catalogo_mcp_tool (
  id TEXT PRIMARY KEY,
  servidor_id TEXT NOT NULL REFERENCES catalogo_item(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT,
  verificado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_catalogo_mcp_tool ON catalogo_mcp_tool (servidor_id, nome);

CREATE TABLE catalogo_politica (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  alvo_tipo TEXT NOT NULL CHECK (alvo_tipo IN ('papel','agente','missao')),
  alvo_valor TEXT NOT NULL,
  skills_json TEXT NOT NULL DEFAULT '[]',
  mcp_do_usuario TEXT NOT NULL DEFAULT 'nenhum' CHECK (mcp_do_usuario IN ('nenhum','lista')),
  servidores_mcp_json TEXT NOT NULL DEFAULT '[]',
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_catalogo_politica ON catalogo_politica (workspace_id, alvo_tipo, alvo_valor);

CREATE TABLE catalogo_pane_politica (
  pane_id TEXT PRIMARY KEY REFERENCES pane(id) ON DELETE CASCADE,
  cli TEXT NOT NULL,
  nivel_isolamento TEXT NOT NULL CHECK (nivel_isolamento IN ('duro','parcial','nenhum')),
  skills_json TEXT,
  mcp_do_usuario TEXT NOT NULL,
  servidores_mcp_json TEXT NOT NULL,
  resolvido_em TEXT NOT NULL
);

CREATE TABLE catalogo_embarcada (
  nome TEXT NOT NULL,
  cli TEXT NOT NULL,
  versao_instalada TEXT,
  hash_instalado TEXT,
  opt_out INTEGER NOT NULL DEFAULT 0 CHECK (opt_out IN (0,1)),
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (nome, cli)
) WITHOUT ROWID;

CREATE TABLE catalogo_varredura (
  id TEXT PRIMARY KEY,
  gatilho TEXT NOT NULL CHECK (gatilho IN ('boot','workspace','manual','tela')),
  iniciada_em TEXT NOT NULL,
  duracao_ms INTEGER,
  adicionados INTEGER,
  atualizados INTEGER,
  ausentes INTEGER,
  erros_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE gateway_config (
  workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  ativo INTEGER NOT NULL DEFAULT 0 CHECK (ativo IN (0,1)),
  modo_superficie TEXT NOT NULL DEFAULT 'reduzido' CHECK (modo_superficie IN ('completo','reduzido','busca')),
  max_ferramentas INTEGER NOT NULL DEFAULT 40 CHECK (max_ferramentas BETWEEN 1 AND 200),
  limite_por_min INTEGER NOT NULL DEFAULT 60 CHECK (limite_por_min BETWEEN 1 AND 600),
  ocioso_s INTEGER NOT NULL DEFAULT 300 CHECK (ocioso_s BETWEEN 30 AND 3600),
  atualizado_em TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE gateway_filtro (
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  servidor_id TEXT NOT NULL,
  ferramenta TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('piloto','executor','explorador','revisor')),
  habilitada INTEGER NOT NULL CHECK (habilitada IN (0,1)),
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (workspace_id, servidor_id, ferramenta, papel)
) WITHOUT ROWID;

CREATE TABLE gateway_pane (
  pane_id TEXT PRIMARY KEY REFERENCES pane(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  mission_id TEXT,
  papel TEXT NOT NULL,
  modo TEXT NOT NULL,
  servidores_json TEXT NOT NULL DEFAULT '[]',
  criado_em TEXT NOT NULL,
  expira_em TEXT NOT NULL
);

CREATE TABLE gateway_auditoria (
  id TEXT PRIMARY KEY,
  em TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  pane_id TEXT NOT NULL,
  papel TEXT NOT NULL,
  servidor_id TEXT,
  ferramenta TEXT,
  decisao TEXT NOT NULL CHECK (decisao IN ('permitida','negada_filtro','negada_limite','negada_servidor','erro')),
  duracao_ms INTEGER,
  bytes_entrada INTEGER,
  bytes_saida INTEGER
);
CREATE INDEX ix_gateway_auditoria_em ON gateway_auditoria (em);
CREATE INDEX ix_gateway_auditoria_ws ON gateway_auditoria (workspace_id, em);
`;

export const migracao0018: Migracao = {
  versao: 18,
  nome: "0018-catalogo-gateway",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
