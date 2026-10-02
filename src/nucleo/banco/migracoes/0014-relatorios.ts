import type { Migracao } from "../migrar";

// Fase 19 (T-19.02): documentação e relatórios de entrega. Número 0014 (0011 = gestão ágil, 0012 = custo, 0013 = alertas). Ids ULID com prefixo; momentos UTC ISO com ms;
// booleano INTEGER 0/1; desconhecido = NULL (nunca 0). CASCADE por workspace nas tabelas-raiz; filhas seguem o pai.
// O conteúdo dos relatórios NÃO mora aqui: fica em arquivos sob `<raiz>/<pasta do produto>/relatorios/` (caminho RELATIVO em `pasta_ref`); o banco guarda só metadados, hashes
// e o que é decisão humana (config, consentimento, ajustes, aprovação, fila de divulgação). Nada aqui guarda código-fonte, segredo nem caminho absoluto, exceto
// `relatorio_exportacao.destino`, que é a pasta que a própria pessoa escolheu no diálogo do sistema (como `workspace.raiz`).
// Desvios do plano (registrados em D-19x): `hash_geracao` (idempotência por fatos+modo+ajustes), `relatorio_ajuste` ganha `workspace_id`, e `relatorio_divulgacao` é a fila de envio.
const SQL = `
CREATE TABLE relatorio_config (
  workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  json TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE relatorio_pacote (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  sprint_id TEXT NOT NULL,
  titulo TEXT NOT NULL,
  versao INTEGER NOT NULL CHECK (versao >= 1),
  versao_lancamento TEXT,
  hash_fatos TEXT NOT NULL,
  hash_geracao TEXT NOT NULL,
  modo_redacao TEXT NOT NULL CHECK (modo_redacao IN ('template','llm','misto')),
  modo_bloco_json TEXT NOT NULL DEFAULT '{}',
  estado TEXT NOT NULL CHECK (estado IN ('gerando','pronto','falhou','obsoleto')),
  etapa TEXT,
  revisao_usuario TEXT NOT NULL DEFAULT 'rascunho' CHECK (revisao_usuario IN ('rascunho','aprovado')),
  aprovado_em TEXT,
  pasta_ref TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  avisos_json TEXT NOT NULL DEFAULT '[]',
  metricas_json TEXT NOT NULL DEFAULT '{}',
  verificacao_json TEXT,
  motivo_falha TEXT,
  gerado_em TEXT NOT NULL,
  UNIQUE (workspace_id, sprint_id, versao)
);
CREATE INDEX ix_relatorio_pacote_ws ON relatorio_pacote (workspace_id, gerado_em);
CREATE INDEX ix_relatorio_pacote_hash ON relatorio_pacote (workspace_id, sprint_id, hash_geracao);

CREATE TABLE relatorio_arquivo (
  pacote_id TEXT NOT NULL REFERENCES relatorio_pacote(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  formato TEXT NOT NULL CHECK (formato IN ('html','md','csv','json','txt')),
  publico TEXT NOT NULL CHECK (publico IN ('interno','cliente','gestao','maquina')),
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  revisao TEXT NOT NULL DEFAULT 'rascunho' CHECK (revisao IN ('rascunho','aprovado','na')),
  PRIMARY KEY (pacote_id, nome)
);

CREATE TABLE relatorio_ajuste (
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  sprint_id TEXT NOT NULL,
  bloco_id TEXT NOT NULL,
  texto_md TEXT NOT NULL CHECK (length(texto_md) <= 20000),
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (workspace_id, sprint_id, bloco_id)
);

CREATE TABLE relatorio_exportacao (
  id TEXT PRIMARY KEY,
  pacote_id TEXT NOT NULL REFERENCES relatorio_pacote(id) ON DELETE CASCADE,
  modo TEXT NOT NULL CHECK (modo IN ('pasta','zip')),
  destino TEXT NOT NULL,
  arquivos_json TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  em TEXT NOT NULL
);

CREATE TABLE relatorio_divulgacao (
  id TEXT PRIMARY KEY,
  pacote_id TEXT NOT NULL REFERENCES relatorio_pacote(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  canal TEXT NOT NULL,
  variante TEXT NOT NULL CHECK (variante IN ('curta','media','longa')),
  texto TEXT NOT NULL CHECK (length(texto) <= 2000),
  estado TEXT NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho','aprovado','enviado','falhou','cancelado')),
  criado_em TEXT NOT NULL,
  enviado_em TEXT,
  erro TEXT
);
CREATE INDEX ix_relatorio_divulgacao_pacote ON relatorio_divulgacao (pacote_id, criado_em);
`;

export const migracao0014: Migracao = {
  versao: 14,
  nome: "0014-relatorios",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
