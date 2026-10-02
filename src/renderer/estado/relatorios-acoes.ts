// Pedidos de abertura da tela Relatórios vindos da paleta (⌘K). A tela é lazy: um pedido sem ouvinte espera pouco pelo primeiro.
import { pedirTela } from "./navegacao";

export type PedidoRelatorios = "abrir" | "pacotes" | "revisao" | "divulgacao" | "config" | "gerar";
export const VALIDADE_PEDIDO_RELATORIOS_MS = 4_000;

const ouvintes = new Set<(p: PedidoRelatorios) => void>();
let pendente: { pedido: PedidoRelatorios; em: number } | null = null;

export function pedirRelatorios(pedido: PedidoRelatorios): void {
  pedirTela("relatorios");
  if (ouvintes.size === 0) { pendente = { pedido, em: Date.now() }; return; }
  pendente = null;
  [...ouvintes].forEach((o) => o(pedido));
}
export function aoPedirRelatorios(ouvinte: (p: PedidoRelatorios) => void): () => void {
  ouvintes.add(ouvinte);
  if (pendente !== null) { const p = pendente; pendente = null; if (Date.now() - p.em <= VALIDADE_PEDIDO_RELATORIOS_MS) ouvinte(p.pedido); }
  return () => void ouvintes.delete(ouvinte);
}
