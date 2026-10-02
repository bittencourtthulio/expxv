// montarDetalhe (T-10.13): monta o `CardDetalhe` de UM card a partir de dados já lidos. PURO. Nada de caminho absoluto sai daqui (o texto de rastro e de violação é saneado)
// e `arquivo_task` é sempre relativo; só `board:abrir_arquivo` o resolve, no main, com as travas de `arquivo.ts`.
import type { CardBoard, CardDetalhe, CustoResumo, MovimentoCard, Tokens, OrigemUsd } from "../../compartilhado/custo";
import type { TaskDoMetodo } from "./portas";

/** Remove caminhos absolutos (POSIX e Windows) de um texto livre do método, antes de ele atravessar a fronteira do IPC. */
export function sanearTexto(t: string, max = 240): string {
  const limpo = t
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"'`)\]]+/g, "[caminho]")
    .replace(/(^|[\s"'(`=])\/(?:Users|home|var|private|tmp|opt|etc|mnt|root|Volumes)\/[^\s"'`)\]]*/g, "$1[caminho]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return limpo.length > max ? `${limpo.slice(0, max - 1)}…` : limpo;
}
/** Caminho relativo seguro para `arquivo_task`: só `/`, sem `..`, sem raiz; senão `null`. */
export function relativoSeguro(rel: string | null | undefined): string | null {
  if (rel === null || rel === undefined || rel === "") return null;
  if (rel.includes("\0") || rel.includes("\\") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel) || rel.split("/").includes("..")) return null;
  return rel;
}

export interface EntradaDetalhe {
  card: CardBoard;
  task: TaskDoMetodo;
  janela: { inicio: string; fim: string | null; origem: "banco" | "rastro" } | null;
  violacoes: ReadonlyArray<{ alvo: string; detalhe: string }>;
  custo: CustoResumo;
  custo_por_modelo: ReadonlyArray<{ modelo: string | null; tokens: Tokens; usd: number | null; origem: OrigemUsd; aproximado: boolean }>;
  panes: ReadonlyArray<{ pane_id: string; cli: string; modelo: string | null; conta_rotulo: string | null; papel: string }>;
  handoffs: ReadonlyArray<{ id: string; status: string; resumo: string; criado_em: string }>;
  rastro: ReadonlyArray<{ ts: string; evento: string; detalhe: string; task: string | null }>;
  movimentos: readonly MovimentoCard[];
}
export const LIMITE_RASTRO = 50;

export function montarDetalhe(e: EntradaDetalhe): CardDetalhe {
  const rastro = e.rastro
    .filter((r) => r.task === e.task.id)
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
    .slice(-LIMITE_RASTRO)
    .map((r) => ({ ts: r.ts, evento: sanearTexto(r.evento, 80), detalhe: sanearTexto(r.detalhe) }));
  return {
    card: e.card,
    contrato: { objetivo: e.task.objetivo, criterio_aceite: e.task.criterio_aceite, teste_integracao: e.task.teste_integracao, teste_funcional: e.task.teste_funcional, teste_regressao: e.task.teste_regressao },
    janela: e.janela,
    violacoes: e.violacoes.filter((v) => v.alvo === e.task.id).map((v) => sanearTexto(v.detalhe)),
    custo: e.custo,
    custo_por_modelo: e.custo_por_modelo.map((m) => ({ ...m })),
    panes: e.panes.map((p) => ({ ...p })),
    handoffs: e.handoffs.map((h) => ({ id: h.id, status: h.status, resumo: sanearTexto(h.resumo, 400), criado_em: h.criado_em })),
    rastro,
    arquivo_task: relativoSeguro(e.task.arquivo),
    movimentos: [...e.movimentos],
  };
}
