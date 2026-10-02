// Pedidos de abertura de aba do Harness vindos da paleta. A tela é lazy: um pedido sem ouvinte espera pouco pelo primeiro.
import { pedirTela } from "./navegacao";

export type AbaHarness = "politica" | "equivalencia" | "contas" | "decisoes" | "cofre";
export const VALIDADE_PEDIDO_HARNESS_MS = 4_000;

const ouvintes = new Set<(a: AbaHarness) => void>();
let pendente: { aba: AbaHarness; em: number } | null = null;

export function pedirHarness(aba: AbaHarness): void {
  pedirTela("harness");
  if (ouvintes.size === 0) { pendente = { aba, em: Date.now() }; return; }
  pendente = null;
  [...ouvintes].forEach((o) => o(aba));
}
export function aoPedirHarness(ouvinte: (a: AbaHarness) => void): () => void {
  ouvintes.add(ouvinte);
  if (pendente !== null) { const p = pendente; pendente = null; if (Date.now() - p.em <= VALIDADE_PEDIDO_HARNESS_MS) ouvinte(p.aba); }
  return () => void ouvintes.delete(ouvinte);
}
