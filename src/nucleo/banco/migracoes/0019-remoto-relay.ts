import type { Migracao } from "../migrar";

// Fase 22 (T-22.03): relay cego. Estende a Fase 13 SEM alterar tabelas existentes. Número 0019 (0018 = catálogo/gateway; conferido na execução).
//  - NÃO altera `remoto_dispositivo` (a suíte da Fase 13 enumera as colunas da tabela e não pode ser editada: D-367). O transporte vive em `relay_canal.transporte`:
//    dispositivo sem linha em `relay_canal` = 'lan' (o que a Fase 13 já fazia); com linha = 'relay' ou 'ambos'.
//  - `relay_canal`: estado do canal do dispositivo no relay (só a ÚLTIMA época usada; o segredo de canal vive no cofre do SO, nunca aqui; `canal_id` nunca é gravado).
//  - `relay_evento`: auditoria própria (30 dias, retenção por job), SEM conteúdo, sem IP, sem canal_id.
const SQL = `
CREATE TABLE relay_canal (
  dispositivo_id TEXT PRIMARY KEY REFERENCES remoto_dispositivo(id) ON DELETE CASCADE,
  transporte TEXT NOT NULL DEFAULT 'relay' CHECK (transporte IN ('relay','ambos')),
  epoca_ultima INTEGER NOT NULL,
  registrado_em TEXT NOT NULL,
  revogado_em TEXT,
  ultimo_visto_em TEXT
);

CREATE TABLE relay_evento (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('ligado','desligado','conectado','desconectado','pareamento_aberto','pareamento_concluido','pareamento_falhou','revogado','panico','quadro_invalido','relay_indisponivel')),
  dispositivo_id TEXT,
  motivo TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_relay_evento_criado ON relay_evento (criado_em DESC);
`;

export const migracao0019: Migracao = {
  versao: 19,
  nome: "0019-remoto-relay",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
