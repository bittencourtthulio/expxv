import type { Migracao } from "../migrar";

// Fase 15 (T-15.04): configuração do conhecimento por workspace e o histórico do chat orquestrador. Só METADADO e texto já
// redigido: segredo de backend online nunca entra aqui (cofre do SO). O índice (chunks, vetores, grafo) vive em OUTRO arquivo,
// `conhecimento.db`, com migrations próprias (src/nucleo/conhecimento/migracoes). `chat_execucao` segue P-52: confirmar sempre,
// direto só para ação reversível (padrão) ou direto total (opt-in). Datas: UTC ISO com ms. Booleano: INTEGER 0/1.
const SQL = `
CREATE TABLE conhecimento_config (
  workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  consulta_obrigatoria TEXT NOT NULL DEFAULT 'aviso' CHECK (consulta_obrigatoria IN ('off','aviso','bloqueio')),
  contexto_chars INTEGER NOT NULL DEFAULT 2000 CHECK (contexto_chars BETWEEN 500 AND 6000),
  hook_prompt INTEGER NOT NULL DEFAULT 1 CHECK (hook_prompt IN (0,1)),
  indexar_codigo INTEGER NOT NULL DEFAULT 1 CHECK (indexar_codigo IN (0,1)),
  indexar_transcricoes INTEGER NOT NULL DEFAULT 1 CHECK (indexar_transcricoes IN (0,1)),
  aprendizado_modo TEXT NOT NULL DEFAULT 'deterministico' CHECK (aprendizado_modo IN ('deterministico','assistido')),
  retencao_transcricao_dias INTEGER NOT NULL DEFAULT 90 CHECK (retencao_transcricao_dias BETWEEN 7 AND 730),
  chat_execucao TEXT NOT NULL DEFAULT 'reversiveis' CHECK (chat_execucao IN ('confirmar','reversiveis','total')),
  atualizado_em TEXT NOT NULL
);

CREATE TABLE chat_conversa (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  modo TEXT NOT NULL CHECK (modo IN ('perguntar','orquestrar')),
  perfil_json TEXT NOT NULL,
  mission_alvo_id TEXT,
  indexar INTEGER NOT NULL DEFAULT 0 CHECK (indexar IN (0,1)),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_chat_conversa_ws ON chat_conversa (workspace_id, atualizado_em);

CREATE TABLE chat_mensagem (
  id TEXT PRIMARY KEY,
  conversa_id TEXT NOT NULL REFERENCES chat_conversa(id) ON DELETE CASCADE,
  papel TEXT NOT NULL CHECK (papel IN ('usuario','assistente','sistema','progresso')),
  texto TEXT NOT NULL,
  citacoes_json TEXT,
  plano_id TEXT,
  estado TEXT NOT NULL DEFAULT 'completa' CHECK (estado IN ('transmitindo','completa','erro','cancelada')),
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_chat_msg ON chat_mensagem (conversa_id, criado_em);

CREATE TABLE chat_plano (
  id TEXT PRIMARY KEY,
  conversa_id TEXT NOT NULL REFERENCES chat_conversa(id) ON DELETE CASCADE,
  intencao TEXT NOT NULL,
  plano_json TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('proposto','aprovado','executando','concluido','cancelado','falhou')),
  mission_id TEXT,
  pane_ids_json TEXT NOT NULL DEFAULT '[]',
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_chat_plano_conversa ON chat_plano (conversa_id, criado_em);
`;

export const migracao0009: Migracao = {
  versao: 9,
  nome: "0009-conhecimento-chat",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
