// Ordenação determinística dos cards (a ordem de entrada nunca muda a saída) e comparação natural de ids `T-NN.MM`.
import type { CardBoard, OrdenacaoBoard } from "../../compartilhado/custo";

/** Compara "T-03.10" > "T-03.9" por número, não por texto. */
export function compararNatural(a: string, b: string): number {
  const pa = a.split(/(\d+)/);
  const pb = b.split(/(\d+)/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (x === y) continue;
    if (i % 2 === 1) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else return x < y ? -1 : 1;
  }
  return 0;
}

export interface ExtraOrdem {
  concluida_em: string | null;
}
export function comparadorDeCards(ordem: OrdenacaoBoard, agrupar: "nenhum" | "trabalho" | "fase", extra: ReadonlyMap<string, ExtraOrdem>): (a: CardBoard, b: CardBoard) => number {
  const plano = (a: CardBoard, b: CardBoard): number =>
    compararNatural(a.trabalho_id, b.trabalho_id) || compararNatural(a.fase ?? "", b.fase ?? "") || compararNatural(a.task_id, b.task_id) || (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0);
  const grupo = (a: CardBoard, b: CardBoard): number => {
    if (agrupar === "trabalho") return compararNatural(a.trabalho_id, b.trabalho_id);
    if (agrupar === "fase") return compararNatural(a.fase ?? "", b.fase ?? "") || compararNatural(a.trabalho_id, b.trabalho_id);
    return 0;
  };
  if (ordem === "custo") return (a, b) => grupo(a, b) || (b.custo.usd ?? -1) - (a.custo.usd ?? -1) || plano(a, b);
  if (ordem === "recente") {
    return (a, b) => {
      const ca = extra.get(a.chave)?.concluida_em ?? "";
      const cb = extra.get(b.chave)?.concluida_em ?? "";
      return grupo(a, b) || (ca === cb ? 0 : ca < cb ? 1 : -1) || plano(a, b);
    };
  }
  return (a, b) => grupo(a, b) || plano(a, b);
}
