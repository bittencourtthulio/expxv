import type { Migracao } from "../migrar";

// Fase 13 (T-13.14/T-13.02): Jarvis e controle remoto. Número 0017 (0016 = bench). Tabelas globais do app.
//  - `remoto_dispositivo`: SÓ a chave pública do dispositivo (ECDSA P-256, SPKI base64); nenhum segredo de dispositivo no servidor. Revogado nunca autentica.
//  - `jarvis_auditoria`: uma linha por passo (ator jarvis|remoto|sistema), args REDIGIDOS (sem texto de fala, token nem chave), retenção 30 dias.
//  - `jarvis_idempotencia`: (ator, dispositivo, client_request_id) único; TTL 24 h; impede duplicar prompt/pedido por repetição de requisição.
const SQL = `
CREATE TABLE remoto_dispositivo (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 40),
  chave_publica TEXT NOT NULL,
  permissao TEXT NOT NULL CHECK (permissao IN ('leitura','mensagem_confirmada','mensagem_direta')),
  criado_em TEXT NOT NULL,
  ultimo_uso_em TEXT,
  ultimo_ip TEXT,
  expira_em TEXT NOT NULL,
  revogado_em TEXT
);
CREATE INDEX ix_remoto_dispositivo_ativo ON remoto_dispositivo (revogado_em, expira_em);

CREATE TABLE jarvis_auditoria (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  ator TEXT NOT NULL CHECK (ator IN ('jarvis','remoto','sistema')),
  dispositivo_id TEXT,
  evento TEXT NOT NULL,
  acao TEXT,
  risco TEXT CHECK (risco IS NULL OR risco IN ('leitura','escrita_leve','escrita')),
  origem TEXT,
  confirmado_por TEXT NOT NULL DEFAULT 'nenhum' CHECK (confirmado_por IN ('nenhum','ui','desktop')),
  ok INTEGER NOT NULL CHECK (ok IN (0,1)),
  codigo TEXT,
  args_hash TEXT,
  resumo TEXT,
  latencia_ms INTEGER
);
CREATE INDEX ix_jarvis_auditoria_ts ON jarvis_auditoria (ts DESC, id);

CREATE TABLE jarvis_idempotencia (
  ator TEXT NOT NULL CHECK (ator IN ('jarvis','remoto')),
  dispositivo_id TEXT NOT NULL DEFAULT '',
  client_request_id TEXT NOT NULL,
  resultado_json TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  PRIMARY KEY (ator, dispositivo_id, client_request_id)
);
`;

export const migracao0017: Migracao = {
  versao: 17,
  nome: "0017-jarvis-remoto",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
