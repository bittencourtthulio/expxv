import type { Migracao } from "../migrar";

// Fase 7B (T-07B.04): estado local da Loja de MCPs. Só METADADO: valor de segredo nunca entra aqui (vive no cofre do SO).
// Sem chaves estrangeiras: `removerServidor` apaga o dependente explicitamente e MANTÉM `catalogo_mcp_consentimento`
// (auditoria). Datas: UTC ISO com ms. Booleano: INTEGER 0/1. Caminhos relativos a `userData`.
const SQL = `
CREATE TABLE catalogo_mcp_instalado (
  servidor_id TEXT PRIMARY KEY,
  versao TEXT NOT NULL,
  metodo TEXT NOT NULL CHECK (metodo IN ('npm','uvx','binario','docker','remoto')),
  estado TEXT NOT NULL CHECK (estado IN ('instalando','instalado','falhou','removendo')),
  nivel_verificacao TEXT NOT NULL CHECK (nivel_verificacao IN ('forte','padrao','remoto')),
  integridade TEXT,
  pasta_rel TEXT,
  comando_hash TEXT NOT NULL,
  seed_versao TEXT NOT NULL,
  erro_codigo TEXT,
  instalado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE catalogo_mcp_consentimento (
  id TEXT PRIMARY KEY,
  servidor_id TEXT NOT NULL,
  versao TEXT NOT NULL,
  comando_hash TEXT NOT NULL,
  permissoes_json TEXT NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('loja','kit','atualizacao','cli_usuario')),
  aceito_em TEXT NOT NULL
);
CREATE INDEX ix_catalogo_mcp_cons ON catalogo_mcp_consentimento (servidor_id, aceito_em);

CREATE TABLE catalogo_mcp_variavel (
  servidor_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  definida INTEGER NOT NULL DEFAULT 0 CHECK (definida IN (0,1)),
  atualizada_em TEXT,
  PRIMARY KEY (servidor_id, nome)
) WITHOUT ROWID;

CREATE TABLE catalogo_mcp_habilitacao (
  id TEXT PRIMARY KEY,
  servidor_id TEXT NOT NULL,
  alvo_tipo TEXT NOT NULL CHECK (alvo_tipo IN ('workspace','missao','agente')),
  alvo_valor TEXT NOT NULL,
  habilitado INTEGER NOT NULL CHECK (habilitado IN (0,1)),
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_catalogo_mcp_hab ON catalogo_mcp_habilitacao (servidor_id, alvo_tipo, alvo_valor);

CREATE TABLE catalogo_mcp_saude (
  servidor_id TEXT PRIMARY KEY,
  estado TEXT NOT NULL CHECK (estado IN ('ok','indisponivel','nao_testado')),
  testado_em TEXT,
  latencia_ms INTEGER,
  n_ferramentas INTEGER,
  erro_codigo TEXT
) WITHOUT ROWID;

CREATE TABLE catalogo_mcp_ferramenta (
  servidor_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  descricao TEXT,
  visto_em TEXT NOT NULL,
  PRIMARY KEY (servidor_id, nome)
) WITHOUT ROWID;

CREATE TABLE catalogo_mcp_cli_instalacao (
  servidor_id TEXT NOT NULL,
  cli TEXT NOT NULL CHECK (cli IN ('claude','codex','opencode','gemini')),
  nome_na_cli TEXT NOT NULL,
  escopo TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  PRIMARY KEY (servidor_id, cli)
) WITHOUT ROWID;

CREATE TABLE catalogo_mcp_log (
  id TEXT PRIMARY KEY,
  servidor_id TEXT NOT NULL,
  nivel TEXT NOT NULL CHECK (nivel IN ('info','aviso','erro')),
  evento TEXT NOT NULL,
  detalhe_json TEXT NOT NULL DEFAULT '{}',
  em TEXT NOT NULL
);
CREATE INDEX ix_catalogo_mcp_log ON catalogo_mcp_log (servidor_id, em);

CREATE TABLE catalogo_mcp_kit (
  opt_out INTEGER NOT NULL DEFAULT 0 CHECK (opt_out IN (0,1)),
  atualizado_em TEXT NOT NULL
);
`;

export const migracao0008: Migracao = {
  versao: 8,
  nome: "0008-loja-mcp",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
