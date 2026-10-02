// Pedidos de abertura/ação da tela Mapa vindos da paleta (⌘K). A tela é lazy: um pedido sem ouvinte espera pouco pelo primeiro.
import { pedirTela } from "./navegacao";

export type PedidoMapa = "abrir" | "analisar" | "atualizar" | "buscar" | "perfil" | "hotspots" | "ciclos";
export const VALIDADE_PEDIDO_MAPA_MS = 4_000;

const ouvintes = new Set<(p: PedidoMapa) => void>();
let pendente: { pedido: PedidoMapa; em: number } | null = null;

export function pedirMapa(pedido: PedidoMapa): void {
  pedirTela("mapa");
  if (ouvintes.size === 0) { pendente = { pedido, em: Date.now() }; return; }
  pendente = null;
  [...ouvintes].forEach((o) => o(pedido));
}
export function aoPedirMapa(ouvinte: (p: PedidoMapa) => void): () => void {
  ouvintes.add(ouvinte);
  if (pendente !== null) { const p = pendente; pendente = null; if (Date.now() - p.em <= VALIDADE_PEDIDO_MAPA_MS) ouvinte(p.pedido); }
  return () => void ouvintes.delete(ouvinte);
}
