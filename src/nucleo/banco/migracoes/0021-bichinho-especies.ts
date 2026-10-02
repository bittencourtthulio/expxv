import type { Migracao } from "../migrar";

// Bichinho: 100 espécies, variante visual, contador de tarefas do ovo e aviso de reatribuição (D-670…D-674). Número 0021 (0020 = bichinho; conferido na execução).
// O SQLite não altera CHECK: a tabela é reconstruída (cópia na ordem do rowid, que é a ordem da PRIMEIRA atribuição e desempata "o mais antigo mantém a espécie").
// Aditivo: nenhum dado é perdido; `especie_manual` já existia (0 = automática); as colunas novas nascem com padrão neutro (variante 0, 0 tarefas, sem aviso).
// A lista de espécies abaixo é uma CÓPIA CONGELADA do catálogo desta versão (ids ASCII estáveis): espécie nova no futuro = migration nova.
const ESPECIES_V21 = [
  "caranguejo", "piton", "esquilo", "raposa", "camaleao", "lontra", "tucano", "elefante", "ourico", "coruja", "polvo", "gato", "sapo", "urso",
  "capivara", "lobo", "tigre", "leao", "pantera", "lince", "guepardo", "onca", "panda", "coala", "canguru", "preguica", "tamandua", "tatu", "anta", "suricato", "lemure",
  "macaco", "gorila", "cervo", "alce", "camelo", "lhama", "cavalo", "zebra", "girafa", "rinoceronte", "hipopotamo", "javali", "porco-espinho", "castor", "ornitorrinco",
  "vombate", "quokka", "morcego", "coelho", "ovelha", "guaxinim", "texugo", "bisao", "foca",
  "arara", "pinguim", "falcao", "corvo", "pavao", "flamingo", "pato", "cisne", "pelicano", "beija-flor", "avestruz", "gaivota",
  "tartaruga", "jacare", "lagarto", "iguana", "komodo", "osga",
  "axolote", "salamandra", "perereca",
  "baleia", "golfinho", "tubarao", "arraia", "baiacu", "cavalo-marinho", "peixe-lua",
  "agua-viva", "estrela-do-mar", "lula", "lagosta", "nautilo", "caracol",
  "abelha", "joaninha", "borboleta", "louva-a-deus", "escaravelho", "formiga", "libelula", "grilo", "vaga-lume", "aranha", "escorpiao",
] as const;

const LISTA = ESPECIES_V21.map((e) => `'${e}'`).join(",");

const SQL = `
CREATE TABLE workspace_bichinho_v21 (
  workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  especie TEXT NOT NULL CHECK (especie IN (${LISTA})),
  especie_manual INTEGER NOT NULL DEFAULT 0 CHECK (especie_manual IN (0,1)),
  apelido TEXT CHECK (apelido IS NULL OR length(apelido) BETWEEN 1 AND 24),
  maturidade_max INTEGER NOT NULL DEFAULT 0 CHECK (maturidade_max BETWEEN 0 AND 100),
  estagio TEXT NOT NULL DEFAULT 'ovo' CHECK (estagio IN ('ovo','filhote','jovem','adulto','veterano','lendario')),
  atualizado_em TEXT NOT NULL,
  variante INTEGER NOT NULL DEFAULT 0 CHECK (variante BETWEEN 0 AND 3),
  tarefas_concluidas INTEGER NOT NULL DEFAULT 0 CHECK (tarefas_concluidas >= 0),
  reatribuido_de TEXT CHECK (reatribuido_de IS NULL OR reatribuido_de IN (${LISTA}))
);
INSERT INTO workspace_bichinho_v21 (workspace_id, especie, especie_manual, apelido, maturidade_max, estagio, atualizado_em)
  SELECT workspace_id, especie, especie_manual, apelido, maturidade_max, estagio, atualizado_em FROM workspace_bichinho ORDER BY rowid;
DROP TABLE workspace_bichinho;
ALTER TABLE workspace_bichinho_v21 RENAME TO workspace_bichinho;
CREATE INDEX ix_bichinho_especie ON workspace_bichinho (especie);
`;

export const migracao0021: Migracao = {
  versao: 21,
  nome: "0021-bichinho-especies",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
