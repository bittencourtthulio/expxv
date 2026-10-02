// Pedidos de abertura das telas de custo vindos da paleta (⌘K) e do popover do rodapé. As telas são lazy (e ficam montadas ocultas):
// o ouvinte se inscreve só nos pedidos que trata; pedido sem ouvinte desse tipo espera pouco pelo primeiro.
import { pedirTela } from "./navegacao";

export type PedidoCusto = "board" | "detalhe" | "fontes";
export const VALIDADE_PEDIDO_CUSTO_MS = 4_000;
interface Ouvinte { tipos: readonly PedidoCusto[]; fn: (p: PedidoCusto) => void }
const ouvintes = new Set<Ouvinte>();
const pendentes = new Map<PedidoCusto, number>();

export function pedirCusto(pedido: PedidoCusto): void {
  pedirTela(pedido === "board" ? "missoes" : "consumo");
  const alvo = [...ouvintes].filter((o) => o.tipos.includes(pedido));
  if (alvo.length === 0) { pendentes.set(pedido, Date.now()); return; }
  pendentes.delete(pedido);
  alvo.forEach((o) => o.fn(pedido));
}
export function aoPedirCusto(tipos: readonly PedidoCusto[], fn: (p: PedidoCusto) => void): () => void {
  const o: Ouvinte = { tipos, fn };
  ouvintes.add(o);
  for (const t of tipos) {
    const em = pendentes.get(t);
    if (em === undefined) continue;
    pendentes.delete(t);
    if (Date.now() - em <= VALIDADE_PEDIDO_CUSTO_MS) fn(t);
  }
  return () => void ouvintes.delete(o);
}
