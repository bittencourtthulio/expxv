import type { Banco, Parametros } from "../banco";
import { ValorInvalidoErro } from "../../dominio";
import { JANELAS_AMOSTRA, JANELAS_SEMANA, MAX_PONTOS_HISTORICO, type AmostraLimite, type JanelaAmostra } from "../../../compartilhado/limites";
import { exigirEnum, textoObrigatorio } from "./comum";
import { numeroEm } from "./json";

export interface AmostraComFonte extends AmostraLimite {
  fonte: string;
}
export interface SemanaLimite {
  semana_inicio: string;
  conta_id: string;
  janela: "five_hour" | "weekly";
  pico_pct: number;
  estourou: boolean;
  estouro_precoce: boolean;
  amostras: number;
}
export interface ConsultaAmostras {
  conta_id: string;
  janela: JanelaAmostra;
  /** nome do balde (família do modelo); vazio para as janelas gerais. */
  balde?: string;
  desde: string;
  ate: string;
  /** ≤ 300; acima disso decima em SQL (1 a cada k, sempre com o último ponto). */
  max_pontos: number;
}
export const RETENCAO_AMOSTRAS_DIAS = 90;

interface LinhaSemana {
  semana_inicio: string;
  conta_id: string;
  janela: "five_hour" | "weekly";
  pico_pct: number;
  estourou: number;
  estouro_precoce: number;
  amostras: number;
}

/** Histórico de consumo (só mudanças; retenção 90 dias) e a eficiência semanal permanente (`limite_semana`). */
export function criarRepoLimiteAmostra(banco: Banco) {
  return {
    /** Grava o lote em UMA transação; (conta, janela, balde, ts) repetido é ignorado. Devolve quantas entraram. */
    gravarLote(amostras: readonly AmostraComFonte[]): number {
      if (amostras.length === 0) return 0;
      return banco.transacao((tx) => {
        const ins = tx.preparar("INSERT OR IGNORE INTO limite_amostra (conta_id,janela,balde,ts,usado_pct,reinicia_em,fonte) VALUES (?,?,?,?,?,?,?)");
        let n = 0;
        for (const a of amostras) {
          exigirEnum("janela", a.janela, JANELAS_AMOSTRA);
          textoObrigatorio("conta_id", a.conta_id);
          textoObrigatorio("ts", a.ts);
          numeroEm("usado_pct", a.usado_pct, 0, 100);
          if ((a.janela === "modelo") !== (a.balde !== "")) throw new ValorInvalidoErro("balde", a.balde);
          n += ins.executar([a.conta_id, a.janela, a.balde, a.ts, a.usado_pct, a.reinicia_em, textoObrigatorio("fonte", a.fonte)]).alteracoes;
        }
        return n;
      });
    },
    /** Última amostra da série (para decidir se mudou ≥ 1 ponto ou passaram 10 min). */
    ultima(contaId: string, janela: JanelaAmostra, balde = ""): AmostraLimite | undefined {
      return banco.consultarUm<AmostraLimite>(
        "SELECT conta_id, janela, balde, ts, usado_pct, reinicia_em FROM limite_amostra WHERE conta_id = ? AND janela = ? AND balde = ? ORDER BY ts DESC LIMIT 1",
        [contaId, janela, balde],
      );
    },
    /** Série em ordem de tempo, decimada em SQL para no máximo `max_pontos` (≤ 300) pontos. */
    consultar(q: ConsultaAmostras): AmostraLimite[] {
      const max = Math.floor(numeroEm("max_pontos", q.max_pontos, 1, MAX_PONTOS_HISTORICO));
      const balde = q.balde ?? "";
      const base: Parametros = [q.conta_id, q.janela, balde, q.desde, q.ate];
      const onde = "conta_id = ? AND janela = ? AND balde = ? AND ts >= ? AND ts <= ?";
      const n = Number(banco.consultarUm<{ n: number }>(`SELECT COUNT(*) AS n FROM limite_amostra WHERE ${onde}`, base)?.n ?? 0);
      if (n <= max) return banco.consultar<AmostraLimite>(`SELECT conta_id, janela, balde, ts, usado_pct, reinicia_em FROM limite_amostra WHERE ${onde} ORDER BY ts`, base);
      const k = Math.ceil(n / max);
      return banco.consultar<AmostraLimite>(
        `SELECT conta_id, janela, balde, ts, usado_pct, reinicia_em FROM (
           SELECT *, ROW_NUMBER() OVER (ORDER BY ts) AS rn FROM limite_amostra WHERE ${onde}
         ) WHERE rn % ? = 0 OR rn = ? ORDER BY ts`,
        [...(base as readonly (string | number)[]), k, n],
      );
    },
    /** Retenção: apaga amostras anteriores a `antesDe` (padrão do chamador: agora − 90 dias). */
    podar(antesDe: string): number {
      return banco.executar("DELETE FROM limite_amostra WHERE ts < ?", [antesDe]).alteracoes;
    },
    /** Eficiência semanal: mantém o MAIOR pico visto, soma as amostras e acumula estouro/estouro precoce. Permanente. */
    registrarSemana(d: { semana_inicio: string; conta_id: string; janela: "five_hour" | "weekly"; pico_pct: number; estourou: boolean; estouro_precoce: boolean; amostras: number }): SemanaLimite {
      exigirEnum("janela", d.janela, JANELAS_SEMANA);
      numeroEm("pico_pct", d.pico_pct, 0, 100);
      banco.executar(
        `INSERT INTO limite_semana (semana_inicio,conta_id,janela,pico_pct,estourou,estouro_precoce,amostras) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(semana_inicio,conta_id,janela) DO UPDATE SET pico_pct = MAX(pico_pct, excluded.pico_pct),
           estourou = MAX(estourou, excluded.estourou), estouro_precoce = MAX(estouro_precoce, excluded.estouro_precoce), amostras = amostras + excluded.amostras`,
        [d.semana_inicio, d.conta_id, d.janela, d.pico_pct, d.estourou ? 1 : 0, d.estouro_precoce ? 1 : 0, Math.max(0, Math.floor(d.amostras))],
      );
      return this.semana(d.semana_inicio, d.conta_id, d.janela) as SemanaLimite;
    },
    semana(semanaInicio: string, contaId: string, janela: "five_hour" | "weekly"): SemanaLimite | undefined {
      const l = banco.consultarUm<LinhaSemana>("SELECT * FROM limite_semana WHERE semana_inicio = ? AND conta_id = ? AND janela = ?", [semanaInicio, contaId, janela]);
      return l ? { ...l, estourou: l.estourou === 1, estouro_precoce: l.estouro_precoce === 1 } : undefined;
    },
    /** As últimas `semanas` (≤ 26) semanas, mais recentes primeiro; `contaId` opcional. */
    listarSemanas(semanas: number, contaId?: string): SemanaLimite[] {
      const n = Math.floor(numeroEm("semanas", semanas, 1, 26));
      const linhas =
        contaId === undefined
          ? banco.consultar<LinhaSemana>("SELECT * FROM limite_semana WHERE semana_inicio IN (SELECT DISTINCT semana_inicio FROM limite_semana ORDER BY semana_inicio DESC LIMIT ?) ORDER BY semana_inicio DESC, conta_id, janela", [n])
          : banco.consultar<LinhaSemana>("SELECT * FROM limite_semana WHERE conta_id = ? AND semana_inicio IN (SELECT DISTINCT semana_inicio FROM limite_semana WHERE conta_id = ? ORDER BY semana_inicio DESC LIMIT ?) ORDER BY semana_inicio DESC, janela", [contaId, contaId, n]);
      return linhas.map((l) => ({ ...l, estourou: l.estourou === 1, estouro_precoce: l.estouro_precoce === 1 }));
    },
  };
}
export type RepoLimiteAmostra = ReturnType<typeof criarRepoLimiteAmostra>;
