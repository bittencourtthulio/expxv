import type { Migracao } from "../migrar";

// Bichinho do workspace (D-460…, D-465): estado persistido por workspace. Número 0020 (0019 = relay; conferido na execução).
// SÓ metadados do bichinho (espécie efetiva, apelido, maturidade máxima, estágio): nenhum conteúdo de conversa. A maturidade é monotônica
// (`maturidade_max` só sobe) e a troca manual de espécie fica marcada em `especie_manual` (0 = automática). Datas UTC ISO com ms.
const SQL = `
CREATE TABLE workspace_bichinho (
  workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  especie TEXT NOT NULL CHECK (especie IN ('caranguejo','piton','esquilo','raposa','camaleao','lontra','tucano','elefante','ourico','coruja','polvo','gato','sapo','urso')),
  especie_manual INTEGER NOT NULL DEFAULT 0 CHECK (especie_manual IN (0,1)),
  apelido TEXT CHECK (apelido IS NULL OR length(apelido) BETWEEN 1 AND 24),
  maturidade_max INTEGER NOT NULL DEFAULT 0 CHECK (maturidade_max BETWEEN 0 AND 100),
  estagio TEXT NOT NULL DEFAULT 'ovo' CHECK (estagio IN ('ovo','filhote','jovem','adulto','veterano','lendario')),
  atualizado_em TEXT NOT NULL
);
`;

export const migracao0020: Migracao = {
  versao: 20,
  nome: "0020-bichinho",
  aplicar(banco) {
    banco.executar(SQL);
  },
};
