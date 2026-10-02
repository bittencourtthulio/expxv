// Pedidos de abertura da tela Bench vindos da paleta (⌘K) e do atalho ⌘⇧B / Ctrl+Shift+B. A tela é lazy: um pedido sem ouvinte espera pouco pelo primeiro.
// `Rodar` NÃO tem atalho nem comando de paleta que inicie Run (de propósito): iniciar exige o diálogo de consentimento digitado.
import { pedirTela } from "./navegacao";

export type PedidoBench = "abrir" | "comparar" | "alvos" | "precos" | "sugestao";
export const VALIDADE_PEDIDO_BENCH_MS = 4_000;

const ouvintes = new Set<(p: PedidoBench) => void>();
let pendente: { pedido: PedidoBench; em: number } | null = null;

export function pedirBench(pedido: PedidoBench): void {
  pedirTela("bench");
  if (ouvintes.size === 0) { pendente = { pedido, em: Date.now() }; return; }
  pendente = null;
  [...ouvintes].forEach((o) => o(pedido));
}
export function aoPedirBench(ouvinte: (p: PedidoBench) => void): () => void {
  ouvintes.add(ouvinte);
  if (pendente !== null) { const p = pendente; pendente = null; if (Date.now() - p.em <= VALIDADE_PEDIDO_BENCH_MS) ouvinte(p.pedido); }
  return () => void ouvintes.delete(ouvinte);
}

/** ⌘⇧B (mac) / Ctrl+Shift+B abre a tela; com Alt ou outra tecla não. */
export function ehAtalhoDoBench(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, mac: boolean): boolean {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const letra = (e.code?.startsWith("Key") ? e.code.slice(3) : e.key).toLowerCase();
  return mod && e.shiftKey && !e.altKey && letra === "b";
}

/** ouvinte global ÚNICO e barato (só lê teclas com modificador). */
export function ligarAtalhosBench(alvo: Pick<Window, "addEventListener" | "removeEventListener"> = window, mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "")): () => void {
  const f = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (!ehAtalhoDoBench(k, mac)) return;
    k.preventDefault();
    pedirBench("abrir");
  };
  alvo.addEventListener("keydown", f);
  return () => alvo.removeEventListener("keydown", f);
}
