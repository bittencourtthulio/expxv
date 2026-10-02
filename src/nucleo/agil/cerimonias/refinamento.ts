// T-18.12: cerimônia de refinamento = fila de refino + quebras sugeridas, como conteúdo salvável (`agil_cerimonia`, tipo `refinamento`).
import type { ConfigAgil } from "../../../compartilhado/agil";
import { filaDeRefino, sugerirQuebra, type ContextoDoR } from "../backlog/refinar";

export interface ConteudoRefinamento { itens: { item_id: string; titulo: string; falhas: { codigo: string; motivo: string }[]; quebra_sugerida: number[] | null }[] }

export function montarRefinamento(itens: readonly ContextoDoR[], config: Pick<ConfigAgil, "dor">): ConteudoRefinamento {
  return {
    itens: filaDeRefino(itens, config).map(({ ctx, falhas }) => ({
      item_id: ctx.item.id, titulo: ctx.item.titulo, falhas: falhas.map((f) => ({ codigo: f.codigo, motivo: f.motivo })), quebra_sugerida: sugerirQuebra(ctx.pontos),
    })),
  };
}
