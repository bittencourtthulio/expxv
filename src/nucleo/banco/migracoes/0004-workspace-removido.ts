import type { Migracao } from "../migrar";

// AUD-11: remover um workspace passa a ser LÓGICO. O histórico (Missões, Panes, cards, handoffs, eventos) fica no
// banco; as listagens ocultam o workspace; reabrir o mesmo caminho o restaura. Apagar de verdade é uma ação à parte.
export const migracao0004: Migracao = {
  versao: 4,
  nome: "0004-workspace-removido",
  aplicar(banco) {
    banco.executar("ALTER TABLE workspace ADD COLUMN removido_em TEXT");
  },
};
