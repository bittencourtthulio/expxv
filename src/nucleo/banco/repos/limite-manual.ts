import type { Banco } from "../banco";
import { agora } from "../tempo";
import { NaoEncontradoErro } from "../../dominio";
import { JANELAS_MANUAIS, type JanelaManual } from "../../../compartilhado/limites";
import { exigirEnum } from "./comum";
import { numeroEm } from "./json";

export interface LimiteManual {
  conta_id: string;
  janela: JanelaManual;
  usado_pct: number;
  reinicia_em: string | null;
  informado_em: string;
}

/** Valor que o dono informa à mão (confiança `manual`); expira quando `reinicia_em` passa. Sobrevive a reinício. */
export function criarRepoLimiteManual(banco: Banco) {
  return {
    definir(contaId: string, janela: JanelaManual, usadoPct: number, reiniciaEm: string | null, instante: string = agora()): LimiteManual {
      exigirEnum("janela", janela, JANELAS_MANUAIS);
      numeroEm("usado_pct", usadoPct, 0, 100);
      if (banco.consultarUm("SELECT 1 AS x FROM conta WHERE id = ?", [contaId]) === undefined) throw new NaoEncontradoErro("Conta", contaId);
      banco.executar(
        `INSERT INTO limite_manual (conta_id,janela,usado_pct,reinicia_em,informado_em) VALUES (?,?,?,?,?)
         ON CONFLICT(conta_id,janela) DO UPDATE SET usado_pct = excluded.usado_pct, reinicia_em = excluded.reinicia_em, informado_em = excluded.informado_em`,
        [contaId, janela, usadoPct, reiniciaEm, instante],
      );
      return banco.consultarUm<LimiteManual>("SELECT * FROM limite_manual WHERE conta_id = ? AND janela = ?", [contaId, janela]) as LimiteManual;
    },
    /** Sem `janela`, limpa todas as janelas da conta. Devolve quantas foram removidas. */
    limpar(contaId: string, janela?: JanelaManual): number {
      if (janela !== undefined) return banco.executar("DELETE FROM limite_manual WHERE conta_id = ? AND janela = ?", [contaId, janela]).alteracoes;
      return banco.executar("DELETE FROM limite_manual WHERE conta_id = ?", [contaId]).alteracoes;
    },
    listar(contaId?: string): LimiteManual[] {
      return contaId === undefined
        ? banco.consultar<LimiteManual>("SELECT * FROM limite_manual ORDER BY conta_id, janela")
        : banco.consultar<LimiteManual>("SELECT * FROM limite_manual WHERE conta_id = ? ORDER BY janela", [contaId]);
    },
    /** Remove os valores cujo `reinicia_em` já passou (o ciclo recomeçou: o número informado deixou de valer). */
    limparVencidos(agoraIso: string = agora()): number {
      return banco.executar("DELETE FROM limite_manual WHERE reinicia_em IS NOT NULL AND reinicia_em <= ?", [agoraIso]).alteracoes;
    },
  };
}
export type RepoLimiteManual = ReturnType<typeof criarRepoLimiteManual>;
