import { memo, type KeyboardEvent } from "react";
import type { CardBoard } from "../../../compartilhado/custo";
import { CUSTO_DESCONHECIDO, explicarCusto, formatarCusto } from "../../estado/custo-formato";
import { ariaCard, GLIFO_COLUNA, GLIFO_SELO, ROTULO_SELO, siglaCli } from "./rotulos";

export const ALTURA_CARD = 26;
/** contador de renders (só leitura em teste/perf): prova que atualizar 1 card re-renderiza só ele. */
export const contadorRenders = { cards: 0 };

export interface PropsCard {
  card: CardBoard;
  selecionado: boolean;
  aoAbrir: (c: CardBoard) => void;
  /** posição na lista virtualizada (0-based) e tamanho da lista: o card se posiciona sozinho (sem wrapper). */
  indice: number;
  tamanho: number;
}

/**
 * Card em UM elemento DOM (P-116: o orçamento conta elementos). Glifo de estado + T-NN.MM saem por `::before` (data-glifo/data-id) e selos + custo + CLI por `::after`
 * (data-fim); o título é o texto direto (elipse). O nome acessível é `aria-label` (nunca depende do CSS). `memo`: só re-renderiza quando o card (referência) muda.
 */
export const CardLinha = memo(function CardLinha({ card, selecionado, aoAbrir, indice, tamanho }: PropsCard) {
  contadorRenders.cards++;
  const custo = formatarCusto(card.custo);
  const selos = card.selos.slice(0, 2).map((s) => GLIFO_SELO[s]).join("");
  const fim = [selos, custo, card.executor !== null ? siglaCli(card.executor.cli) : ""].filter((x) => x !== "").join(" ");
  const tecla = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      aoAbrir(card);
    }
  };
  return (
    <div
      role="article"
      tabIndex={0}
      className="bd-card"
      data-coluna={card.coluna}
      data-chave={card.chave}
      data-glifo={GLIFO_COLUNA[card.coluna]}
      data-id={card.task_id}
      data-fim={fim}
      data-pos={indice}
      data-selecionado={selecionado || undefined}
      data-desconhecido={custo === CUSTO_DESCONHECIDO || undefined}
      aria-label={ariaCard(card)}
      aria-posinset={indice + 1}
      aria-setsize={tamanho}
      aria-current={selecionado || undefined}
      style={{ top: indice * ALTURA_CARD, height: ALTURA_CARD }}
      title={[card.titulo, ...card.selos.slice(0, 2).map((s) => ROTULO_SELO[s]), explicarCusto(card.custo)].join(" — ")}
      onClick={() => aoAbrir(card)}
      onKeyDown={tecla}
    >
      {card.titulo}
    </div>
  );
});
