// Regras de movimento DERIVADAS do estado do método (D-04/D-107): o ADE NUNCA move card nem grava no método. Cada "movimento" diz se a transição é possível, QUEM a faz
// (o método por comando digitado, um worker delegado, ou um humano — validação e merge são humanos, D-21) e o motivo. `grava_no_metodo` é sempre false. PURO.
import type { CardBoard, ColunaBoard, InfoWip, MovimentoCard } from "../../compartilhado/custo";
import { COLUNAS_BOARD } from "../../compartilhado/custo";

export interface ContextoMovimento {
  wip: Record<ColunaBoard, InfoWip>;
  /** modo da Missão do card (`null` = sem Missão): só squad/agêntico delegam a worker. */
  modo_missao?: "livre" | "squad" | "agentico" | null;
  /** comando do método (digitado no terminal, D-20) para o gesto; `null` quando o método não tem comando aplicável. */
  comandoDe?: (gesto: "executar" | "retomar" | "corrigir", card: CardBoard) => string | null;
}

/** Entrar na coluna agora estouraria o limite? (`excedido` é `total > limite` — já estourou; um card A MAIS em quem está no limite também estoura.) */
export const wipAtingido = (w: InfoWip): boolean => w.limite !== null && w.total >= w.limite;

const mv = (para: ColunaBoard, permitido: boolean, acao: MovimentoCard["acao"], motivo: string, comando: string | null = null): MovimentoCard => ({ para, permitido, acao, motivo, comando, grava_no_metodo: false });

export function movimentosDoCard(card: CardBoard, ctx: ContextoMovimento): MovimentoCard[] {
  const cmd = (g: "executar" | "retomar" | "corrigir"): string | null => ctx.comandoDe?.(g, card) ?? null;
  const delega = (ctx.modo_missao === "squad" || ctx.modo_missao === "agentico") && card.mission_id !== null;
  const wipEm = ctx.wip.em_andamento;
  switch (card.coluna) {
    case "backlog": {
      const motivo = card.selos.includes("bloqueada") ? "A task está bloqueada: o bloqueio se resolve no método, não no quadro." : "Há dependência aberta: conclua as tasks de que ela depende.";
      return [mv("a_fazer", false, "nenhuma", motivo)];
    }
    case "a_fazer": {
      if (wipAtingido(wipEm)) return [mv("em_andamento", false, "nenhuma", `Limite de trabalho em andamento atingido (${wipEm.total}/${wipEm.limite}).`)];
      if (card.selos.includes("delegada")) return [mv("em_andamento", false, "abrir_pane", "A task já foi delegada: abra o Pane do executor.")];
      if (delega) return [mv("em_andamento", true, "delegar", "Delegar a um worker da Missão (pede confirmação).", cmd("executar"))];
      return [mv("em_andamento", true, "copiar_comando", "Execute no terminal com o comando do método.", cmd("executar"))];
    }
    case "em_andamento":
      return [mv("em_revisao", false, "nenhuma", "O card sai daqui quando o worker entrega (handoff) e o método marca a task como concluída."), mv("a_fazer", false, "nenhuma", "Voltar para 'A fazer' é decisão do método (retomar/replanejar).", cmd("retomar"))];
    case "em_revisao":
      return [mv("validado", false, "humano", "Validação é humana ou do avaliador em Pane separado (D-21); o ADE só reflete.")];
    case "concluido":
      return [mv("validado", false, "humano", "Validação é humana ou do avaliador em Pane separado (D-21); o ADE só reflete."), mv("em_andamento", true, "copiar_comando", "Reabrir para correção segue o método (runx).", cmd("corrigir"))];
    case "validado":
      return [];
  }
}

/** Valida UM movimento pedido; transição inexistente na tabela é recusada com motivo (nunca grava). */
export function validarMovimento(card: CardBoard, para: ColunaBoard, ctx: ContextoMovimento): MovimentoCard {
  if (!COLUNAS_BOARD.includes(para)) return mv(para, false, "nenhuma", "Coluna desconhecida.");
  return movimentosDoCard(card, ctx).find((m) => m.para === para) ?? mv(para, false, "nenhuma", "Movimento não previsto pelo método para esta coluna.");
}
