// Rótulos, glifos e textos de acessibilidade do Board (puros). Cor nunca é o único sinal: todo estado tem glifo e texto.
import { COLUNAS_BOARD, type CardBoard, type ColunaBoard, type SeloCard, type SuiteCard } from "../../../compartilhado/custo";
import { formatarCusto } from "../../estado/custo-formato";

export { COLUNAS_BOARD };
export const ROTULO_COLUNA: Record<ColunaBoard, string> = { backlog: "Backlog", a_fazer: "A fazer", em_andamento: "Em andamento", em_revisao: "Em revisão", concluido: "Concluído", validado: "Validado" };
/** glifo de estado (a coluna): `✓` concluído (verde), `✔` validado (azul). */
export const GLIFO_COLUNA: Record<ColunaBoard, string> = { backlog: "○", a_fazer: "◐", em_andamento: "▶", em_revisao: "◎", concluido: "✓", validado: "✔" };
export const ROTULO_SELO: Record<SeloCard, string> = { pronta: "pronta", bloqueada: "bloqueada", violacao: "violação", descartada: "descartada", delegada: "delegada" };
export const GLIFO_SELO: Record<SeloCard, string> = { pronta: "●", bloqueada: "⊘", violacao: "!", descartada: "✕", delegada: "⇢" };
export const ROTULO_SUITE: Record<SuiteCard, string> = { verde: "suíte verde", vermelha: "suíte vermelha", parcial: "suíte parcial", nao_executada: "suíte não executada" };

/** "T-03.04, em andamento, pronta, ≥ US$ 1,80": o que o leitor de tela anuncia. */
export function ariaCard(c: CardBoard): string {
  const selos = c.selos.map((s) => ROTULO_SELO[s]).join(", ");
  return [c.task_id, ROTULO_COLUNA[c.coluna].toLowerCase(), selos === "" ? null : selos, formatarCusto(c.custo)].filter((x): x is string => x !== null).join(", ");
}

/** Sigla de 2 letras da CLI (ícone de 12 px sem asset novo). */
export const siglaCli = (cli: string): string => cli.slice(0, 2).toLowerCase();

export function duracao(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
