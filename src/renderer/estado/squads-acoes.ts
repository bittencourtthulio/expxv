// Pedidos vindos da paleta (⌘K) para a tela Squads: "Nova Missão com squad…" e "Abrir agente…". A tela é lazy e os controles só
// montam depois do estado: um pedido sem ouvinte espera pouco tempo pelo primeiro ouvinte interessado (mesmo padrão do versionamento).
import { pedirTela } from "./navegacao";

export type PedidoSquads = "nova-missao-squad" | "abrir-agente" | "nova-squad" | "importar";

export const VALIDADE_PEDIDO_SQUADS_MS = 4_000;

const ouvintes = new Map<PedidoSquads, Set<() => void>>();
const pendentes = new Map<PedidoSquads, number>();

/** Leva à tela Squads e entrega o pedido. "Nova Missão com squad" abre o wizard na tela Missões (a dona do wizard). */
export function pedirSquads(p: PedidoSquads): void {
  pedirTela(p === "nova-missao-squad" ? "missoes" : "squads");
  const ativos = ouvintes.get(p);
  if (ativos === undefined || ativos.size === 0) {
    pendentes.set(p, Date.now());
    return;
  }
  pendentes.delete(p);
  [...ativos].forEach((o) => o());
}

/** Escuta só os pedidos listados. Devolve o cancelamento. */
export function aoPedirSquads(ouvinte: (p: PedidoSquads) => void, interesses: readonly PedidoSquads[]): () => void {
  const desfazer: Array<() => void> = [];
  for (const p of interesses) {
    const cb = (): void => ouvinte(p);
    let c = ouvintes.get(p);
    if (c === undefined) {
      c = new Set();
      ouvintes.set(p, c);
    }
    c.add(cb);
    desfazer.push(() => void c.delete(cb));
    const desde = pendentes.get(p);
    if (desde !== undefined) {
      pendentes.delete(p);
      if (Date.now() - desde <= VALIDADE_PEDIDO_SQUADS_MS) cb();
    }
  }
  return () => desfazer.forEach((d) => d());
}
