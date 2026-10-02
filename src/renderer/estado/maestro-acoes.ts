// "Pedir ao Maestro" (paleta ⌘K e atalho do painel): o comando abre um campo compacto na casca. Mesmo padrão dos pedidos entre telas:
// sem ouvinte, o pedido espera pouco tempo pelo primeiro ouvinte.
import type { ContextoPedido } from "../../compartilhado/maestro";

export interface PedidoDeAbertura {
  contexto: ContextoPedido | null;
  /** rótulo curto do alvo ("painel #3"), só para a UI. */
  origem: string | null;
}
export const VALIDADE_PEDIDO_MAESTRO_MS = 4_000;
type Ouvinte = (p: PedidoDeAbertura) => void;
const ouvintes = new Set<Ouvinte>();
let pendente: { p: PedidoDeAbertura; em: number } | null = null;

export function pedirMaestro(contexto: ContextoPedido | null = null, origem: string | null = null): void {
  const p: PedidoDeAbertura = { contexto, origem };
  if (ouvintes.size === 0) { pendente = { p, em: Date.now() }; return; }
  pendente = null;
  [...ouvintes].forEach((o) => o(p));
}
export function aoPedirMaestro(o: Ouvinte): () => void {
  ouvintes.add(o);
  if (pendente !== null) {
    const { p, em } = pendente;
    pendente = null;
    if (Date.now() - em <= VALIDADE_PEDIDO_MAESTRO_MS) o(p);
  }
  return () => void ouvintes.delete(o);
}
