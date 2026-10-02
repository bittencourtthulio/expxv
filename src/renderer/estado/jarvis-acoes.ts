// Pedidos de abertura da tela Jarvis vindos da paleta (⌘K). A tela é lazy: um pedido sem ouvinte espera pouco pelo primeiro.
import type { AbaJarvis } from "../telas/jarvis/logica";
import { pedirTela } from "./navegacao";

export interface PedidoJarvis { aba: AbaJarvis }
export const VALIDADE_PEDIDO_JARVIS_MS = 4_000;

const ouvintes = new Set<(p: PedidoJarvis) => void>();
let pendente: { pedido: PedidoJarvis; em: number } | null = null;

export function pedirJarvis(aba: AbaJarvis): void {
  pedirTela("jarvis");
  if (ouvintes.size === 0) { pendente = { pedido: { aba }, em: Date.now() }; return; }
  pendente = null;
  [...ouvintes].forEach((o) => o({ aba }));
}
export function aoPedirJarvis(ouvinte: (p: PedidoJarvis) => void): () => void {
  ouvintes.add(ouvinte);
  if (pendente !== null) { const p = pendente; pendente = null; if (Date.now() - p.em <= VALIDADE_PEDIDO_JARVIS_MS) ouvinte(p.pedido); }
  return () => void ouvintes.delete(ouvinte);
}
