// Linhas de uma coluna do Board: cards, opcionalmente em faixas recolhíveis por trabalho ou fase (puro).
import type { CardBoard } from "../../../compartilhado/custo";

export type LinhaColuna = { tipo: "card"; chave: string; card: CardBoard } | { tipo: "faixa"; chave: string; rotulo: string; total: number; recolhida: boolean };
export type Agrupamento = "nenhum" | "trabalho" | "fase";

export function linhasDaColuna(cards: readonly CardBoard[], agrupar: Agrupamento, recolhidas: ReadonlySet<string>): LinhaColuna[] {
  if (agrupar === "nenhum") return cards.map((card) => ({ tipo: "card", chave: card.chave, card }));
  const grupos = new Map<string, { rotulo: string; cards: CardBoard[] }>();
  for (const c of cards) {
    const id = agrupar === "trabalho" ? c.trabalho_id : (c.fase ?? "");
    const g = grupos.get(id) ?? { rotulo: agrupar === "trabalho" ? c.trabalho_titulo : c.fase ?? "sem fase", cards: [] };
    g.cards.push(c);
    grupos.set(id, g);
  }
  const linhas: LinhaColuna[] = [];
  for (const [id, g] of grupos) {
    const recolhida = recolhidas.has(`${agrupar}|${id}`);
    linhas.push({ tipo: "faixa", chave: `faixa|${agrupar}|${id}`, rotulo: g.rotulo, total: g.cards.length, recolhida });
    if (!recolhida) for (const card of g.cards) linhas.push({ tipo: "card", chave: card.chave, card });
  }
  return linhas;
}
export const chaveFaixa = (agrupar: Agrupamento, c: CardBoard): string => `${agrupar}|${agrupar === "trabalho" ? c.trabalho_id : (c.fase ?? "")}`;
