// Pedidos de abertura da tela Memória vindos da paleta (⌘K). A tela é lazy: um pedido sem ouvinte espera pouco pelo primeiro.
import { pedirTela } from "./navegacao";

export type PedidoMemoria = "pane" | "missao" | "squad" | "workspace" | "preferencias" | "saude" | "restaurar" | "exportar";
export const VALIDADE_PEDIDO_MEMORIA_MS = 4_000;

const ouvintes = new Set<(p: PedidoMemoria) => void>();
let pendente: { pedido: PedidoMemoria; em: number } | null = null;

export function pedirMemoria(pedido: PedidoMemoria): void {
  pedirTela("memoria");
  if (ouvintes.size === 0) { pendente = { pedido, em: Date.now() }; return; }
  pendente = null;
  [...ouvintes].forEach((o) => o(pedido));
}
export function aoPedirMemoria(ouvinte: (p: PedidoMemoria) => void): () => void {
  ouvintes.add(ouvinte);
  if (pendente !== null) { const p = pendente; pendente = null; if (Date.now() - p.em <= VALIDADE_PEDIDO_MEMORIA_MS) ouvinte(p.pedido); }
  return () => void ouvintes.delete(ouvinte);
}
