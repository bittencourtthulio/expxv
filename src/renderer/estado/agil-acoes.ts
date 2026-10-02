// Pedidos de abertura da tela Gestão ágil vindos da paleta (⌘K) e dos atalhos (⌘⇧A abre, ⌘⌥D daily, ⌘⌥R retro). A tela é lazy: um pedido sem ouvinte espera pouco pelo primeiro.
import { pedirTela } from "./navegacao";

export type PedidoAgil = "abrir" | "painel" | "backlog" | "sprint" | "daily" | "retro" | "qualidade" | "config" | "sincronizar";
export const VALIDADE_PEDIDO_AGIL_MS = 4_000;

const ouvintes = new Set<(p: PedidoAgil) => void>();
let pendente: { pedido: PedidoAgil; em: number } | null = null;

export function pedirAgil(pedido: PedidoAgil): void {
  pedirTela("agil");
  if (ouvintes.size === 0) { pendente = { pedido, em: Date.now() }; return; }
  pendente = null;
  [...ouvintes].forEach((o) => o(pedido));
}
export function aoPedirAgil(ouvinte: (p: PedidoAgil) => void): () => void {
  ouvintes.add(ouvinte);
  if (pendente !== null) { const p = pendente; pendente = null; if (Date.now() - p.em <= VALIDADE_PEDIDO_AGIL_MS) ouvinte(p.pedido); }
  return () => void ouvintes.delete(ouvinte);
}

/** atalho → pedido (puro): ⌘⇧A / Ctrl+Shift+A abre; ⌘⌥D / Ctrl+Alt+D daily; ⌘⌥R / Ctrl+Alt+R retro. */
export function pedidoDoAtalho(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, mac: boolean): PedidoAgil | null {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod) return null;
  const letra = (e.code?.startsWith("Key") ? e.code.slice(3) : e.key).toLowerCase();
  if (e.shiftKey && !e.altKey && letra === "a") return "abrir";
  if (e.altKey && !e.shiftKey && letra === "d") return "daily";
  if (e.altKey && !e.shiftKey && letra === "r") return "retro";
  return null;
}

/** ouvinte global ÚNICO e barato (só lê teclas com modificador). */
export function ligarAtalhosAgil(alvo: Pick<Window, "addEventListener" | "removeEventListener"> = window, mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "")): () => void {
  const f = (e: Event): void => {
    const k = e as KeyboardEvent;
    const p = pedidoDoAtalho(k, mac);
    if (p === null) return;
    k.preventDefault();
    pedirAgil(p);
  };
  alvo.addEventListener("keydown", f);
  return () => alvo.removeEventListener("keydown", f);
}
