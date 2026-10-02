// Pedidos da paleta para a seção OpenRouter (tela Provedores, lazy): um pedido sem ouvinte espera pouco pelo primeiro.
import { pedirTela } from "./navegacao";

export type AlvoOpenRouter = "secao" | "chave" | "modelos";
export const VALIDADE_PEDIDO_OPENROUTER_MS = 4_000;

const ouvintes = new Set<(a: AlvoOpenRouter) => void>();
let pendente: { alvo: AlvoOpenRouter; em: number } | null = null;

export function pedirOpenRouter(alvo: AlvoOpenRouter): void {
  pedirTela("provedores");
  if (ouvintes.size === 0) { pendente = { alvo, em: Date.now() }; return; }
  pendente = null;
  [...ouvintes].forEach((o) => o(alvo));
}
export function aoPedirOpenRouter(ouvinte: (a: AlvoOpenRouter) => void): () => void {
  ouvintes.add(ouvinte);
  if (pendente !== null) { const p = pendente; pendente = null; if (Date.now() - p.em <= VALIDADE_PEDIDO_OPENROUTER_MS) ouvinte(p.alvo); }
  return () => void ouvintes.delete(ouvinte);
}
