// Paralelismo por membro, por squad e global (Fase 14, T-14.14). PURO: as contagens vêm de `invocacao_agente` (invocações
// abertas) e de `pane` (workers vivos). Orçamentos soft de tempo/tokens ficam em `orcamento`, nunca matam um Pane (D-210).
export interface EntradaLimites {
  max_instancias_membro: number;
  max_instancias_paralelas_squad: number;
  vivos_do_membro: number;
  vivos_da_squad: number;
  /** workers vivos da Missão (o piloto não conta). */
  vivos_globais: number;
  /** `max_parallel_panes` (padrão 8). */
  max_global: number;
}
export type ResultadoLimites = { ok: true } | { ok: false; motivo: "membro" | "squad" | "global"; mensagem: string };

export function podeInvocar(e: EntradaLimites): ResultadoLimites {
  if (e.vivos_do_membro >= e.max_instancias_membro) {
    return { ok: false, motivo: "membro", mensagem: `Limite de ${e.max_instancias_membro} instância(s) deste agente atingido.` };
  }
  if (e.vivos_da_squad >= e.max_instancias_paralelas_squad) {
    return { ok: false, motivo: "squad", mensagem: `Limite de ${e.max_instancias_paralelas_squad} terminais paralelos da squad atingido.` };
  }
  if (e.vivos_globais >= e.max_global) {
    return { ok: false, motivo: "global", mensagem: `Limite de ${e.max_global} panes paralelos atingido.` };
  }
  return { ok: true };
}

/** O menor entre o limite da squad, o pedido na caixa de prompt (`max_paralelos`) e o global; nunca abaixo de 1. */
export function limiteEfetivoDaSquad(daSquad: number, pedido: number | null, global: number): number {
  return Math.max(1, Math.min(daSquad, pedido ?? daSquad, global));
}
