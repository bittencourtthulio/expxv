// Pedidos da paleta (⌘K) para a tela Catálogo (lazy): um pedido sem ouvinte espera pouco pelo primeiro ouvinte.
import { pedirTela } from "./navegacao";

export type AlvoCatalogo = "abrir" | "atualizar" | "politica";
export const VALIDADE_PEDIDO_CATALOGO_MS = 4_000;

const ouvintes = new Set<(a: AlvoCatalogo) => void>();
let pendente: { alvo: AlvoCatalogo; em: number } | null = null;

export function pedirCatalogo(alvo: AlvoCatalogo): void {
  pedirTela("catalogo");
  if (ouvintes.size === 0) { pendente = { alvo, em: Date.now() }; return; }
  pendente = null;
  [...ouvintes].forEach((o) => o(alvo));
}
export function aoPedirCatalogo(ouvinte: (a: AlvoCatalogo) => void): () => void {
  ouvintes.add(ouvinte);
  if (pendente !== null) { const p = pendente; pendente = null; if (Date.now() - p.em <= VALIDADE_PEDIDO_CATALOGO_MS) ouvinte(p.alvo); }
  return () => void ouvintes.delete(ouvinte);
}
