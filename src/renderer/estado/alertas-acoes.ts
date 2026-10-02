// Pedidos entre casca e tela Alertas (paleta, rodapé, topo). A tela é lazy: um pedido sem ouvinte espera pouco pelo primeiro.
import { pedirTela } from "./navegacao";

export type AbaAlertas = "alertas" | "regras" | "canais" | "modelos" | "auditoria";
export type PedidoAlertas = { aba: AbaAlertas };
export const VALIDADE_PEDIDO_ALERTAS_MS = 4_000;

const ouvintes = new Set<(p: PedidoAlertas) => void>();
let pendente: { pedido: PedidoAlertas; em: number } | null = null;

/** Abre a tela Alertas na aba pedida. */
export function pedirAlertas(aba: AbaAlertas = "alertas"): void {
  pedirTela("alertas");
  const pedido = { aba };
  if (ouvintes.size === 0) { pendente = { pedido, em: Date.now() }; return; }
  pendente = null;
  [...ouvintes].forEach((o) => o(pedido));
}
export function aoPedirAlertas(ouvinte: (p: PedidoAlertas) => void): () => void {
  ouvintes.add(ouvinte);
  if (pendente !== null) { const p = pendente; pendente = null; if (Date.now() - p.em <= VALIDADE_PEDIDO_ALERTAS_MS) ouvinte(p.pedido); }
  return () => void ouvintes.delete(ouvinte);
}

// ---- pânico: a paleta só PEDE o diálogo de confirmação; quem executa é o diálogo global.
const ouvintesPanico = new Set<() => void>();
export function pedirPanicoTelegram(): void { ouvintesPanico.forEach((o) => o()); }
export function aoPedirPanicoTelegram(o: () => void): () => void { ouvintesPanico.add(o); return () => void ouvintesPanico.delete(o); }
