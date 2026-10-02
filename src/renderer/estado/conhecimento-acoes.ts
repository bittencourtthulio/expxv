// Pedidos de abertura das telas Conhecimento e Chat vindos da paleta (⌘K) e dos atalhos (Chat ⌘⇧K, Conhecimento ⌘⇧G).
// As telas são lazy: um pedido sem ouvinte espera pouco pelo primeiro ouvinte (mesmo padrão de memoria-acoes).
import { pedirTela } from "./navegacao";

export type PedidoConhecimento = "abrir" | "grafo" | "buscar" | "fontes" | "aprendizados" | "backend" | "config" | "reindexar" | "sincronizar";
export type PedidoChat = "abrir" | "perguntar" | "orquestrar";
export const VALIDADE_PEDIDO_CONHECIMENTO_MS = 4_000;

function criarCanal<P>(tela: "conhecimento" | "chat") {
  const ouvintes = new Set<(p: P) => void>();
  let pendente: { pedido: P; em: number } | null = null;
  return {
    pedir(pedido: P): void {
      pedirTela(tela);
      if (ouvintes.size === 0) { pendente = { pedido, em: Date.now() }; return; }
      pendente = null;
      [...ouvintes].forEach((o) => o(pedido));
    },
    ao(ouvinte: (p: P) => void): () => void {
      ouvintes.add(ouvinte);
      if (pendente !== null) { const p = pendente; pendente = null; if (Date.now() - p.em <= VALIDADE_PEDIDO_CONHECIMENTO_MS) ouvinte(p.pedido); }
      return () => void ouvintes.delete(ouvinte);
    },
  };
}
const canalConhecimento = criarCanal<PedidoConhecimento>("conhecimento");
const canalChat = criarCanal<PedidoChat>("chat");
export const pedirConhecimento = canalConhecimento.pedir;
export const aoPedirConhecimento = canalConhecimento.ao;
export const pedirChat = canalChat.pedir;
export const aoPedirChat = canalChat.ao;

type TeclaPedida = { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };
/** ⌘⇧K / Ctrl+Shift+K abre o chat; ⌘⇧G / Ctrl+Shift+G abre o conhecimento (puro). */
export function destinoDoAtalho(e: TeclaPedida, mac: boolean): "chat" | "conhecimento" | null {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || !e.shiftKey || e.altKey) return null;
  const letra = (e.code?.startsWith("Key") ? e.code.slice(3) : e.key).toLowerCase();
  return letra === "k" ? "chat" : letra === "g" ? "conhecimento" : null;
}

/** ouvinte global único e barato (só lê teclas com modificador). */
export function ligarAtalhosConhecimento(alvo: Pick<Window, "addEventListener" | "removeEventListener"> = window, mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "")): () => void {
  const f = (e: Event): void => {
    const k = e as KeyboardEvent;
    const d = destinoDoAtalho(k, mac);
    if (d === null) return;
    k.preventDefault();
    if (d === "chat") pedirChat("abrir"); else pedirConhecimento("abrir");
  };
  alvo.addEventListener("keydown", f);
  return () => alvo.removeEventListener("keydown", f);
}
