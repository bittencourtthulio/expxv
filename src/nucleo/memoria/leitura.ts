// Leitura e `memory_search` (T-08.13). Sempre filtrada pelo CONTEXTO do token (identidade nunca vem do argumento):
// FTS5 com consulta sanitizada ou LIKE com teto de varredura (D-52); saída redigida de novo e limpa de controles.
import type { Banco, Valor } from "../banco";
import { AVISO_NOTICE, BUSCA_LIMITE_MAX, BUSCA_LIMITE_PADRAO, BUSCA_QUERY_MAX, BUSCA_VARREDURA_LIKE_MAX } from "./constantes";
import { consultaFts, ftsDisponivel } from "./fts";
import { raizDaLinhagem } from "./linhagem";
import { ESCOPO_PARA_SCOPE, TIPO_PARA_KIND, type ScopeBusca, SCOPE_BUSCA } from "./mapas";
import { redigirTexto } from "./redacao";
import { MemoriaErro, type ContextoMemoria, type LinhaEntrada, type TipoMemoria } from "./tipos";
import type { Scrubber } from "../cofre/scrubber";

export interface PedidoBusca {
  ctx: ContextoMemoria;
  query?: string | null;
  scope?: ScopeBusca;
  /** Pane de OUTRA linhagem; só no mesmo workspace e na mesma Missão (ou ambos sem Missão). */
  pane_id?: string | null;
  tipos?: TipoMemoria[] | null;
  limit?: number;
  /** como combinar os termos da query: todos (padrão) ou qualquer um (consulta derivada de texto livre). */
  termos?: "todos" | "qualquer";
}

export interface EntradaBuscada {
  id: string;
  kind: string;
  content: string;
  scope: string;
  source: string;
  importance: number;
  created_at: string;
}

export interface ResultadoBusca {
  entries: EntradaBuscada[];
  truncated: boolean;
  notice: string;
}

export interface DepsLeitura {
  banco: Banco;
  agora?: () => Date;
  scrubber?: Pick<Scrubber, "scrub">;
  /** força o caminho LIKE (teste e diagnóstico). */
  semFts?: boolean;
}

export const RESPOSTA_MAX_BYTES = 8 * 1024;
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

interface Recorte {
  sql: string;
  params: Valor[];
}

/** Condição SQL (sobre o alias `e`) que delimita o que o token pode ver; `null` = nada visível. */
export function montarRecorte(banco: Banco, ctx: ContextoMemoria, scope: ScopeBusca, paneAlvo: string | null, agoraIso: string): Recorte | null {
  if (ctx.modo === "off") throw new MemoriaErro("memory_disabled", "A memória está desligada para este Pane.");
  const ativa = "e.estado = 'ativa' AND (e.expira_em IS NULL OR e.expira_em > ?)";
  // `+e.workspace_id`: o "+" impede o planner de varrer o índice do workspace (50 mil linhas) em vez do da linhagem/Missão; a
  // condição continua valendo como cinto de segurança (nunca devolve linha de outro workspace).
  const ws = "+e.workspace_id = ?";
  const wsIdx = "e.workspace_id = ?";
  const porLinhagem = (lin: string): Recorte => ({ sql: `${ativa} AND ${ws} AND e.linhagem_id = ?`, params: [agoraIso, ctx.workspace_id, lin] });
  if (paneAlvo !== null) {
    if (scope !== "pane") throw new MemoriaErro("invalid_argument", "pane_id só vale com scope pane.");
    const alvo = banco.consultarUm<{ workspace_id: string; mission_id: string | null }>("SELECT workspace_id, mission_id FROM pane WHERE id = ?", [paneAlvo]);
    if (!alvo) throw new MemoriaErro("not_found", "Pane não encontrado.");
    if (alvo.workspace_id !== ctx.workspace_id || alvo.mission_id !== ctx.mission_id) throw new MemoriaErro("unauthorized", "Pane fora do seu workspace/Missão.");
    return porLinhagem(raizDaLinhagem(banco, paneAlvo));
  }
  const missao: Recorte | null = ctx.mission_id ? { sql: `${ativa} AND ${ws} AND e.escopo = 'missao' AND e.mission_id = ?`, params: [agoraIso, ctx.workspace_id, ctx.mission_id] } : null;
  const anel2 = (): Recorte => ({
    sql: `${ativa} AND ${wsIdx} AND e.anel = 2 AND (e.escopo = 'workspace'${ctx.squad_slug ? " OR (e.escopo = 'squad' AND e.squad_slug = ?)" : ""})`,
    params: [agoraIso, ctx.workspace_id, ...(ctx.squad_slug ? [ctx.squad_slug] : [])],
  });
  switch (scope) {
    case "pane":
      return ctx.linhagem_id ? porLinhagem(ctx.linhagem_id) : null;
    case "mission":
      return missao;
    case "workspace":
      return anel2();
    case "all_rings": {
      const partes: string[] = [];
      const params: Valor[] = [agoraIso];
      if (ctx.linhagem_id) (partes.push(`(${ws} AND e.linhagem_id = ?)`), params.push(ctx.workspace_id, ctx.linhagem_id));
      if (ctx.mission_id) (partes.push(`(${ws} AND e.escopo = 'missao' AND e.mission_id = ?)`), params.push(ctx.workspace_id, ctx.mission_id));
      partes.push(`(${wsIdx} AND e.anel = 2 AND (e.escopo = 'workspace'${ctx.squad_slug ? " OR (e.escopo = 'squad' AND e.squad_slug = ?)" : ""}))`);
      params.push(ctx.workspace_id, ...(ctx.squad_slug ? [ctx.squad_slug] : []));
      partes.push(`(e.workspace_id IS NULL AND e.anel = 3)`);
      return { sql: `e.estado = 'ativa' AND (e.expira_em IS NULL OR e.expira_em > ?) AND (${partes.join(" OR ")})`, params };
    }
  }
}

const COLS = "e.id, e.tipo, e.conteudo, e.escopo, e.fonte, e.importancia, e.criado_em, e.anel, e.atualizado_em";
type LinhaBusca = Pick<LinhaEntrada, "id" | "tipo" | "conteudo" | "escopo" | "fonte" | "importancia" | "criado_em" | "anel" | "atualizado_em">;

function validar(p: PedidoBusca): { scope: ScopeBusca; limite: number; query: string; tipos: TipoMemoria[] } {
  const scope = p.scope ?? "pane";
  if (!(SCOPE_BUSCA as readonly string[]).includes(scope)) throw new MemoriaErro("invalid_argument", "scope inválido.");
  const limite = p.limit ?? BUSCA_LIMITE_PADRAO;
  if (!Number.isInteger(limite) || limite < 1) throw new MemoriaErro("invalid_argument", "limit inválido.");
  const query = (p.query ?? "").trim();
  if (query.length > BUSCA_QUERY_MAX) throw new MemoriaErro("too_large", `query passa de ${BUSCA_QUERY_MAX} caracteres.`);
  return { scope, limite: Math.min(limite, BUSCA_LIMITE_MAX), query, tipos: p.tipos ?? [] };
}

/** Busca lexical (síncrona). Nunca devolve entrada expirada/substituída nem de fora do recorte do token. */
export function buscar(deps: DepsLeitura, p: PedidoBusca): ResultadoBusca {
  const v = validar(p);
  const agoraIso = (deps.agora ?? (() => new Date()))().toISOString();
  const recorte = montarRecorte(deps.banco, p.ctx, v.scope, p.pane_id ?? null, agoraIso);
  if (!recorte) return { entries: [], truncated: false, notice: AVISO_NOTICE };
  const linhas = consultarLinhas(deps, recorte, v.query, v.tipos, v.limite + 1, v.scope === "all_rings", p.termos === "qualquer");
  return formatar(deps, linhas, v.limite);
}

export function consultarLinhas(deps: DepsLeitura, recorte: Recorte, query: string, tipos: TipoMemoria[], limite: number, porAnel: boolean, ou = false): LinhaBusca[] {
  const filtroTipo = tipos.length > 0 ? ` AND e.tipo IN (${tipos.map(() => "?").join(",")})` : "";
  const parTipo: Valor[] = [...tipos];
  const ordemBase = porAnel ? "e.anel ASC, e.importancia DESC, e.atualizado_em DESC" : "e.importancia DESC, e.atualizado_em DESC";
  const fts = query === "" ? null : consultaFts(query, ou);
  if (query !== "" && fts === null) return [];
  if (fts !== null && !deps.semFts && ftsDisponivel(deps.banco)) {
    try {
      // `rowid IN (subconsulta FTS)`: o SQLite varre primeiro o recorte (índice da linhagem/Missão) e só confere os candidatos no FTS.
      // O plano "FTS primeiro + junção" materializa TODAS as ocorrências (centenas de ms com termo comum em 50 mil entradas).
      return deps.banco.consultar<LinhaBusca>(
        `SELECT ${COLS} FROM memoria_entrada e WHERE ${recorte.sql}${filtroTipo} AND e.rowid IN (SELECT rowid FROM memoria_fts WHERE memoria_fts MATCH ?) ORDER BY ${ordemBase} LIMIT ${limite}`,
        [...recorte.params, ...parTipo, fts],
      );
    } catch {
      /* FTS quebrou em runtime: cai no LIKE */
    }
  }
  if (query === "") {
    return deps.banco.consultar<LinhaBusca>(`SELECT ${COLS} FROM memoria_entrada e WHERE ${recorte.sql}${filtroTipo} ORDER BY ${ordemBase} LIMIT ${limite}`, [...recorte.params, ...parTipo]);
  }
  const termos = (query.normalize("NFKC").match(/[\p{L}\p{N}_]{2,}/gu) ?? []).slice(0, 8);
  if (termos.length === 0) return [];
  const likes = `(${termos.map(() => "x.conteudo LIKE ? ESCAPE '\\'").join(ou ? " OR " : " AND ")})`;
  const parLike = termos.map((t) => `%${t.replace(/[\\%_]/g, "\\$&")}%`);
  return deps.banco.consultar<LinhaBusca>(
    `SELECT * FROM (SELECT ${COLS} FROM memoria_entrada e WHERE ${recorte.sql}${filtroTipo} ORDER BY e.atualizado_em DESC LIMIT ${BUSCA_VARREDURA_LIKE_MAX}) x WHERE ${likes} ORDER BY ${ordemBase.replace(/e\./g, "x.")} LIMIT ${limite}`,
    [...recorte.params, ...parTipo, ...parLike],
  );
}

export function formatar(deps: Pick<DepsLeitura, "scrubber">, linhas: LinhaBusca[], limite: number): ResultadoBusca {
  let truncated = linhas.length > limite;
  const entries: EntradaBuscada[] = [];
  let bytes = 200;
  for (const l of linhas.slice(0, limite)) {
    const conteudo = redigirTexto(l.conteudo.replace(CONTROLES, " "), deps.scrubber ? { scrubber: deps.scrubber } : {}).texto;
    const e: EntradaBuscada = { id: l.id, kind: TIPO_PARA_KIND[l.tipo], content: conteudo, scope: ESCOPO_PARA_SCOPE[l.escopo], source: l.fonte, importance: l.importancia, created_at: l.criado_em };
    const custo = Buffer.byteLength(JSON.stringify(e), "utf8") + 1;
    if (bytes + custo > RESPOSTA_MAX_BYTES) {
      truncated = true;
      break;
    }
    bytes += custo;
    entries.push(e);
  }
  return { entries, truncated, notice: AVISO_NOTICE };
}
