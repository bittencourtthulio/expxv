// Pedidos de captura vindos da paleta (⌘K), do menu e do atalho global. A tela de captura é lazy: um pedido sem ouvinte espera pouco pelo primeiro.
export type PedidoCaptura = "regiao-tela" | "regiao-janela" | "janela" | "quadros-tela" | "quadros-janela" | "quadros-parar" | "galeria";
export const VALIDADE_PEDIDO_CAPTURA_MS = 4_000;

const ouvintes = new Set<(p: PedidoCaptura) => void>();
let pendente: { pedido: PedidoCaptura; em: number } | null = null;

export function pedirCaptura(pedido: PedidoCaptura): void {
  if (ouvintes.size === 0) { pendente = { pedido, em: Date.now() }; return; }
  pendente = null;
  [...ouvintes].forEach((o) => o(pedido));
}

export function aoPedirCaptura(ouvinte: (p: PedidoCaptura) => void): () => void {
  ouvintes.add(ouvinte);
  if (pendente !== null) { const p = pendente; pendente = null; if (Date.now() - p.em <= VALIDADE_PEDIDO_CAPTURA_MS) ouvinte(p.pedido); }
  return () => void ouvintes.delete(ouvinte);
}
