// Notas de versão no formato Keep a Changelog (T-19.18): só itens visíveis ao cliente e entregues; seções na ordem padrão; sem id interno; sem texto de item oculto.
import type { FatoItem, FatosSprint } from "../../../compartilhado/relatorios";
import { itemEntregue } from "../fatos/coletar";
import { fraseDoItem } from "../redacao/deterministico";
import { dataPt } from "../util";

export type SecaoLog = "added" | "changed" | "deprecated" | "removed" | "fixed" | "security";
export const ORDEM_SECOES: readonly SecaoLog[] = ["added", "changed", "deprecated", "removed", "fixed", "security"];
export const ROTULO_SECAO: Record<SecaoLog, string> = { added: "Adicionado", changed: "Alterado", deprecated: "Descontinuado", removed: "Removido", fixed: "Corrigido", security: "Segurança" };

export function secaoDoItem(i: FatoItem): SecaoLog {
  if (i.changelog_tipo !== null) return i.changelog_tipo;
  return i.categoria === "bug" ? "fixed" : i.categoria === "feature" ? "added" : "changed";
}
export function entradasChangelog(f: FatosSprint): { secao: SecaoLog; titulo: string; linhas: { item_id: string; texto: string }[] }[] {
  const vis = f.itens.filter((i) => i.visivel_cliente && itemEntregue(i));
  return ORDEM_SECOES.map((s) => ({ secao: s, titulo: ROTULO_SECAO[s], linhas: vis.filter((i) => secaoDoItem(i) === s).map((i) => ({ item_id: i.item_id, texto: fraseDoItem(i).texto })) })).filter((x) => x.linhas.length > 0);
}
/** versão e data do cabeçalho: `[versão] - AAAA-MM-DD` ou `[Não lançada]`. */
export function cabecalhoVersao(f: FatosSprint): string {
  return f.sprint.versao_lancamento ? `[${f.sprint.versao_lancamento}] - ${f.sprint.fechada_em?.slice(0, 10) ?? f.sprint.fim}` : `[Não lançada] - ${dataPt(f.sprint.fechada_em ?? f.sprint.fim)}`;
}
