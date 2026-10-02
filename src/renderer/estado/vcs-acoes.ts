// Pedidos de versionamento vindos da paleta: a tela Versionamento (dona da ação) os atende. Como a tela é lazy e os controles só
// montam depois do estado, um pedido sem ouvinte espera pouco tempo pelo primeiro ouvinte INTERESSADO naquele pedido.
import { pedirTela } from "./navegacao";

export type PedidoVcs = "commit" | "fetch" | "pull" | "push" | "branches" | "stash" | "abrir-prs";

export const VALIDADE_PEDIDO_VCS_MS = 4_000;

const ouvintes = new Map<PedidoVcs, Set<() => void>>();
const pendentes = new Map<PedidoVcs, number>();

export function pedirVcs(p: PedidoVcs): void {
  pedirTela("versionamento");
  const ativos = ouvintes.get(p);
  if (ativos === undefined || ativos.size === 0) { pendentes.set(p, Date.now()); return; }
  pendentes.delete(p);
  [...ativos].forEach((o) => o());
}

/** Escuta só os pedidos listados. Devolve o cancelamento. */
export function aoPedirVcs(ouvinte: (p: PedidoVcs) => void, interesses: readonly PedidoVcs[] = ["commit", "branches", "stash", "abrir-prs"]): () => void {
  const lista: Array<() => void> = [];
  const desfazer: Array<() => void> = [];
  for (const p of interesses) {
    const cb = (): void => ouvinte(p);
    let c = ouvintes.get(p);
    if (c === undefined) { c = new Set(); ouvintes.set(p, c); }
    c.add(cb);
    lista.push(cb);
    desfazer.push(() => void c.delete(cb));
    const desde = pendentes.get(p);
    if (desde !== undefined) { pendentes.delete(p); if (Date.now() - desde <= VALIDADE_PEDIDO_VCS_MS) cb(); }
  }
  return () => desfazer.forEach((d) => d());
}
