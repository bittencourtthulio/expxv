// Pedidos da paleta (⌘K) para a tela Loja de MCPs (lazy): um pedido sem ouvinte espera pouco pelo primeiro ouvinte.
import { pedirTela } from "./navegacao";

export type AlvoLojaMcp = "abrir" | "kit" | "buscar" | "gateway";
export const VALIDADE_PEDIDO_LOJA_MS = 4_000;

const ouvintes = new Set<(a: AlvoLojaMcp) => void>();
let pendente: { alvo: AlvoLojaMcp; em: number } | null = null;

export function pedirLojaMcp(alvo: AlvoLojaMcp): void {
  pedirTela("loja-mcp");
  if (ouvintes.size === 0) { pendente = { alvo, em: Date.now() }; return; }
  pendente = null;
  [...ouvintes].forEach((o) => o(alvo));
}
export function aoPedirLojaMcp(ouvinte: (a: AlvoLojaMcp) => void): () => void {
  ouvintes.add(ouvinte);
  if (pendente !== null) { const p = pendente; pendente = null; if (Date.now() - p.em <= VALIDADE_PEDIDO_LOJA_MS) ouvinte(p.alvo); }
  return () => void ouvintes.delete(ouvinte);
}
