import type { Banco, Parametros, Valor } from "../banco";
import { agora } from "../tempo";
import { NaoEncontradoErro, ValorInvalidoErro } from "../../dominio";
import { FAIXAS, type Faixa, type ModeloOpenRouter, type PedidoGravarModeloOpenRouter } from "../../../compartilhado/harness";
import { bool, exigirEnum, int, limiteDe, textoObrigatorio } from "./comum";
import { jsonDe, lerJson, numeroOuNulo } from "./json";

/** Campos que a API devolve; preços ausentes são `null` (nunca 0). */
export interface ModeloDaApi {
  id: string;
  nome: string;
  contexto?: number | null;
  suporta_tools?: boolean | null;
  modalidades?: string[] | null;
  preco_entrada_por_mtok?: number | null;
  preco_saida_por_mtok?: number | null;
}
interface Linha {
  id: string;
  nome: string;
  contexto: number | null;
  suporta_tools: number | null;
  preco_entrada_por_mtok: number | null;
  preco_saida_por_mtok: number | null;
  habilitado: number;
  faixa: Faixa | null;
  ordem: number;
  tipos_permitidos_json: string;
}
const COLUNAS = "id,nome,contexto,suporta_tools,preco_entrada_por_mtok,preco_saida_por_mtok,habilitado,faixa,ordem,tipos_permitidos_json";
const mapear = (l: Linha): ModeloOpenRouter => ({
  id: l.id,
  nome: l.nome,
  contexto: l.contexto,
  suporta_tools: l.suporta_tools === null ? null : bool(l.suporta_tools),
  preco_entrada_por_mtok: l.preco_entrada_por_mtok,
  preco_saida_por_mtok: l.preco_saida_por_mtok,
  habilitado: bool(l.habilitado),
  faixa: l.faixa,
  ordem: l.ordem,
  tipos_permitidos: lerJson<string[]>(l.tipos_permitidos_json, []),
});

export interface ResultadoSincronia {
  total: number;
  novos: number;
  removidos: number;
}

export function criarRepoOpenRouterModelo(banco: Banco) {
  const obter = (id: string): ModeloOpenRouter | undefined => {
    const l = banco.consultarUm<Linha>(`SELECT ${COLUNAS} FROM openrouter_modelo WHERE id = ?`, [id]);
    return l ? mapear(l) : undefined;
  };
  return {
    obter,
    /**
     * Sincroniza com a lista da API (só por clique): insere novos, atualiza só os campos da API (preserva
     * habilitado/faixa/ordem/tipos do dono) e remove os que sumiram. Tudo numa transação.
     */
    sincronizar(modelos: readonly ModeloDaApi[], instante: string = agora()): ResultadoSincronia {
      return banco.transacao((tx) => {
        const vistos = new Set<string>();
        let novos = 0;
        const existe = tx.preparar<{ x: number }>("SELECT 1 AS x FROM openrouter_modelo WHERE id = ?");
        const ins = tx.preparar(
          `INSERT INTO openrouter_modelo (id,nome,contexto,suporta_tools,modalidades_json,preco_entrada_por_mtok,preco_saida_por_mtok,visto_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, contexto=excluded.contexto, suporta_tools=excluded.suporta_tools, modalidades_json=excluded.modalidades_json,
             preco_entrada_por_mtok=excluded.preco_entrada_por_mtok, preco_saida_por_mtok=excluded.preco_saida_por_mtok, visto_em=excluded.visto_em, atualizado_em=excluded.atualizado_em`,
        );
        for (const m of modelos) {
          textoObrigatorio("id", m.id);
          if (vistos.has(m.id)) continue;
          vistos.add(m.id);
          if (existe.consultarUm([m.id]) === undefined) novos++;
          const contexto = typeof m.contexto === "number" && Number.isFinite(m.contexto) && m.contexto > 0 ? Math.floor(m.contexto) : null;
          ins.executar([
            m.id, textoObrigatorio("nome", m.nome), contexto, m.suporta_tools == null ? null : int(m.suporta_tools),
            m.modalidades == null ? null : jsonDe("modalidades", m.modalidades), numeroOuNulo(m.preco_entrada_por_mtok), numeroOuNulo(m.preco_saida_por_mtok), instante, instante,
          ]);
        }
        const todos = tx.consultar<{ id: string }>("SELECT id FROM openrouter_modelo").map((r) => r.id);
        const sumidos = todos.filter((id) => !vistos.has(id));
        for (const id of sumidos) tx.executar("DELETE FROM openrouter_modelo WHERE id = ?", [id]);
        return { total: vistos.size, novos, removidos: sumidos.length };
      });
    },
    /** Habilitar/classificar (ação do dono). `faixa` conhecida ou null; `ordem` inteira ≥ 0. */
    gravarClassificacao(d: PedidoGravarModeloOpenRouter): ModeloOpenRouter {
      if (!obter(d.id)) throw new NaoEncontradoErro("ModeloOpenRouter", d.id);
      if (d.faixa !== null) exigirEnum("faixa", d.faixa, FAIXAS);
      if (!Number.isInteger(d.ordem) || d.ordem < 0) throw new ValorInvalidoErro("ordem", d.ordem);
      banco.executar("UPDATE openrouter_modelo SET habilitado = ?, faixa = ?, ordem = ?, tipos_permitidos_json = ?, atualizado_em = ? WHERE id = ?", [
        int(d.habilitado), d.faixa, d.ordem, jsonDe("tipos_permitidos", d.tipos_permitidos), agora(), d.id,
      ]);
      return obter(d.id) as ModeloOpenRouter;
    },
    /** Lista paginada por id, com busca (id/nome, sem caixa) e filtro de habilitados. */
    listar(op: { busca?: string; so_habilitados?: boolean; cursor?: string; limite?: number } = {}): { itens: ModeloOpenRouter[]; proximo: string | null; total: number } {
      const limite = limiteDe(op.limite === undefined ? undefined : { limite: op.limite });
      const cond: string[] = [];
      const params: Valor[] = [];
      if (op.so_habilitados) cond.push("habilitado = 1");
      const busca = op.busca?.trim().toLowerCase();
      if (busca) {
        cond.push("(instr(lower(id), ?) > 0 OR instr(lower(nome), ?) > 0)");
        params.push(busca, busca);
      }
      const onde = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
      const total = Number(banco.consultarUm<{ n: number }>(`SELECT COUNT(*) AS n FROM openrouter_modelo ${onde}`, params as Parametros)?.n ?? 0);
      const pag = [...params];
      const ondePag = op.cursor !== undefined ? `${onde ? onde + " AND" : "WHERE"} id > ?` : onde;
      if (op.cursor !== undefined) pag.push(op.cursor);
      pag.push(limite + 1);
      const linhas = banco.consultar<Linha>(`SELECT ${COLUNAS} FROM openrouter_modelo ${ondePag} ORDER BY id LIMIT ?`, pag as Parametros);
      const temMais = linhas.length > limite;
      const itens = (temMais ? linhas.slice(0, limite) : linhas).map(mapear);
      return { itens, proximo: temMais ? (itens[itens.length - 1] as ModeloOpenRouter).id : null, total };
    },
    /** Habilitados com faixa, na ordem de uso (alimenta a tabela de equivalência efetiva). Usa `ix_or_modelo_habilitado`. */
    habilitados(): ModeloOpenRouter[] {
      return banco.consultar<Linha>(`SELECT ${COLUNAS} FROM openrouter_modelo WHERE habilitado = 1 ORDER BY faixa, ordem, id`).map(mapear);
    },
    contagem(): { total: number; habilitados: number; atualizados_em: string | null } {
      const r = banco.consultarUm<{ total: number; habilitados: number | null; atualizados_em: string | null }>(
        "SELECT COUNT(*) AS total, SUM(habilitado) AS habilitados, MAX(visto_em) AS atualizados_em FROM openrouter_modelo",
      );
      return { total: Number(r?.total ?? 0), habilitados: Number(r?.habilitados ?? 0), atualizados_em: r?.atualizados_em ?? null };
    },
  };
}
export type RepoOpenRouterModelo = ReturnType<typeof criarRepoOpenRouterModelo>;
