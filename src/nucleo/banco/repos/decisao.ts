import type { Banco, Parametros } from "../banco";
import { agora } from "../tempo";
import { ValorInvalidoErro } from "../../dominio";
import {
  CUSTO_ORIGENS,
  FONTES_DECISAO,
  PROPOSITOS_DECISAO,
  TIPOS_DECISAO,
  type CustoOrigem,
  type Decisao,
  type DecisaoEntrada,
  type FonteDecisao,
  type PropositoDecisao,
  type TotaisDecisoes,
} from "../../../compartilhado/harness";
import { bool, exigirEnum, int, limiteDe, novoId, textoObrigatorio } from "./comum";
import { jsonDe, lerJson, numeroEm, numeroOuNulo } from "./json";

interface Linha {
  id: string;
  criado_em: string;
  proposito: PropositoDecisao;
  workspace_id: string | null;
  mission_id: string | null;
  pane_id: string | null;
  tipo: "choice" | "score" | "boolean";
  opcoes_json: string;
  probs_json: string | null;
  escolhida: string;
  confianca: number | null;
  fonte: FonteDecisao;
  escolha_regra: string | null;
  divergiu: number;
  latencia_ms: number | null;
  custo_usd: number | null;
  custo_origem: CustoOrigem | null;
  decisor_json: string | null;
  resumo_enviado: string | null;
  resumo_hash: string | null;
  skills_aplicadas: number;
  recibo: string;
}
const mapear = (l: Linha): Decisao => ({
  id: l.id,
  criado_em: l.criado_em,
  proposito: l.proposito,
  workspace_id: l.workspace_id,
  mission_id: l.mission_id,
  pane_id: l.pane_id,
  tipo: l.tipo,
  opcoes: lerJson<string[]>(l.opcoes_json, []),
  probs: l.probs_json === null ? null : lerJson<Record<string, number>>(l.probs_json, {}),
  escolhida: l.escolhida,
  confianca: l.confianca,
  fonte: l.fonte,
  escolha_regra: l.escolha_regra,
  divergiu: bool(l.divergiu),
  latencia_ms: l.latencia_ms,
  custo_usd: l.custo_usd,
  custo_origem: l.custo_origem,
  decisor: l.decisor_json === null ? null : lerJson(l.decisor_json, null),
  resumo_enviado: l.resumo_enviado,
  resumo_hash: l.resumo_hash,
  skills_aplicadas: bool(l.skills_aplicadas),
  recibo: l.recibo,
});

export const RESUMO_ENVIADO_MAX = 500;

export interface OpcoesListarDecisoes {
  desde?: string;
  proposito?: PropositoDecisao;
  /** id da última decisão da página anterior (ULID: ordem do id = ordem do tempo). */
  cursor?: string;
  limite?: number;
}

export function criarRepoDecisao(banco: Banco) {
  const exigir = (id: string): Decisao => mapear(banco.consultarUm<Linha>("SELECT * FROM decisao WHERE id = ?", [id]) as Linha);
  return {
    /** Grava a Decisão. Invariantes: `escolhida ∈ opcoes`; custo desconhecido é `null` (nunca 0 por omissão). */
    inserir(d: DecisaoEntrada, instante: string = agora()): Decisao {
      exigirEnum("proposito", d.proposito, PROPOSITOS_DECISAO);
      exigirEnum("tipo", d.tipo, TIPOS_DECISAO);
      exigirEnum("fonte", d.fonte, FONTES_DECISAO);
      if (d.custo_origem !== null) exigirEnum("custo_origem", d.custo_origem, CUSTO_ORIGENS);
      textoObrigatorio("recibo", d.recibo);
      if (!Array.isArray(d.opcoes) || d.opcoes.length === 0 || !d.opcoes.includes(d.escolhida)) throw new ValorInvalidoErro("escolhida", d.escolhida);
      if (d.resumo_enviado !== null && d.resumo_enviado.length > RESUMO_ENVIADO_MAX) throw new ValorInvalidoErro("resumo_enviado", `${d.resumo_enviado.length} caracteres`);
      if (d.confianca !== null) numeroEm("confianca", d.confianca, 0, 1);
      const custo = d.custo_usd === null ? null : numeroEm("custo_usd", d.custo_usd, 0, Number.MAX_VALUE);
      const id = novoId("conta", "dec");
      banco.executar(
        `INSERT INTO decisao (id,criado_em,proposito,workspace_id,mission_id,pane_id,tipo,opcoes_json,probs_json,escolhida,confianca,fonte,escolha_regra,divergiu,latencia_ms,custo_usd,custo_origem,decisor_json,resumo_enviado,resumo_hash,skills_aplicadas,recibo)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id, instante, d.proposito, d.workspace_id, d.mission_id, d.pane_id, d.tipo, jsonDe("opcoes", d.opcoes), d.probs === null ? null : jsonDe("probs", d.probs),
          d.escolhida, d.confianca, d.fonte, d.escolha_regra, int(d.divergiu), d.latencia_ms, custo, d.custo_origem,
          d.decisor === null ? null : jsonDe("decisor", d.decisor), d.resumo_enviado, d.resumo_hash, int(d.skills_aplicadas), d.recibo,
        ],
      );
      return exigir(id);
    },
    obter(id: string): Decisao | undefined {
      const l = banco.consultarUm<Linha>("SELECT * FROM decisao WHERE id = ?", [id]);
      return l ? mapear(l) : undefined;
    },
    /** Mais recentes primeiro, paginado por cursor. */
    listar(op: OpcoesListarDecisoes = {}): { itens: Decisao[]; proximo: string | null } {
      const limite = limiteDe(op.limite === undefined ? undefined : { limite: op.limite });
      const cond: string[] = [];
      const params: (string | number)[] = [];
      if (op.desde !== undefined) {
        cond.push("criado_em >= ?");
        params.push(op.desde);
      }
      if (op.proposito !== undefined) {
        cond.push("proposito = ?");
        params.push(op.proposito);
      }
      if (op.cursor !== undefined) {
        cond.push("id < ?");
        params.push(op.cursor);
      }
      params.push(limite + 1);
      const onde = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
      const linhas = banco.consultar<Linha>(`SELECT * FROM decisao ${onde} ORDER BY id DESC LIMIT ?`, params as Parametros);
      const temMais = linhas.length > limite;
      const itens = (temMais ? linhas.slice(0, limite) : linhas).map(mapear);
      return { itens, proximo: temMais ? (itens[itens.length - 1] as Decisao).id : null };
    },
    /** Soma só custos conhecidos; sem nenhum conhecido, `custo_usd` é `null` (nunca 0). */
    totais(desde?: string): TotaisDecisoes {
      const r = banco.consultarUm<{ consultas: number; conhecidos: number; soma: number | null }>(
        `SELECT COUNT(*) AS consultas, SUM(custo_usd IS NOT NULL) AS conhecidos, SUM(custo_usd) AS soma FROM decisao ${desde !== undefined ? "WHERE criado_em >= ?" : ""}`,
        desde !== undefined ? [desde] : [],
      );
      const consultas = Number(r?.consultas ?? 0);
      const conhecidos = Number(r?.conhecidos ?? 0);
      return { consultas, custo_usd: conhecidos > 0 ? numeroOuNulo(r?.soma) : null, custo_desconhecido: consultas - conhecidos };
    },
    /**
     * Retenção (T-09.15): soma em `decisao_agregado_dia` e apaga as decisões anteriores a `antesDe`, em lotes
     * (cada lote é uma transação curta; não bloqueia o main). Idempotente: o que já foi apagado não conta de novo.
     * Devolve quantas decisões foram compactadas.
     */
    compactar(antesDe: string, tamanhoLote = 500): number {
      let total = 0;
      for (;;) {
        const n = banco.transacao((tx) => {
          const ids = tx.consultar<{ id: string }>("SELECT id FROM decisao WHERE criado_em < ? ORDER BY id LIMIT ?", [antesDe, tamanhoLote]).map((r) => r.id);
          if (ids.length === 0) return 0;
          const marcas = ids.map(() => "?").join(",");
          const grupos = tx.consultar<{ dia: string; proposito: string; consultas: number; falhas: number; divergencias: number; conhecidos: number; soma: number | null }>(
            `SELECT substr(criado_em,1,10) AS dia, proposito, COUNT(*) AS consultas, SUM(fonte = 'fallback') AS falhas, SUM(divergiu) AS divergencias,
                    SUM(custo_usd IS NOT NULL) AS conhecidos, SUM(custo_usd) AS soma
               FROM decisao WHERE id IN (${marcas}) GROUP BY dia, proposito`,
            ids,
          );
          for (const g of grupos) {
            tx.executar(
              `INSERT INTO decisao_agregado_dia (dia,proposito,consultas,falhas,divergencias,custo_usd,custo_desconhecido) VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(dia,proposito) DO UPDATE SET consultas = consultas + excluded.consultas, falhas = falhas + excluded.falhas,
                 divergencias = divergencias + excluded.divergencias, custo_desconhecido = custo_desconhecido + excluded.custo_desconhecido,
                 custo_usd = CASE WHEN excluded.custo_usd IS NULL THEN custo_usd WHEN custo_usd IS NULL THEN excluded.custo_usd ELSE custo_usd + excluded.custo_usd END`,
              [g.dia, g.proposito, Number(g.consultas), Number(g.falhas), Number(g.divergencias), Number(g.conhecidos) > 0 ? numeroOuNulo(g.soma) : null, Number(g.consultas) - Number(g.conhecidos)],
            );
          }
          tx.executar(`DELETE FROM decisao WHERE id IN (${marcas})`, ids);
          return ids.length;
        });
        total += n;
        if (n < tamanhoLote) return total;
      }
    },
    agregadoDoDia(dia: string): Array<{ proposito: string; consultas: number; falhas: number; divergencias: number; custo_usd: number | null; custo_desconhecido: number }> {
      return banco.consultar("SELECT proposito, consultas, falhas, divergencias, custo_usd, custo_desconhecido FROM decisao_agregado_dia WHERE dia = ? ORDER BY proposito", [dia]);
    },
  };
}
export type RepoDecisao = ReturnType<typeof criarRepoDecisao>;
