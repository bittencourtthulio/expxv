// Atalho global e comando da paleta (⌘K) do painel de workspaces. Um ouvinte de teclado barato; o painel em si é lazy.
import { storePainelWorkspaces, type StorePainelWorkspaces } from "./painel-workspaces";

const EH_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const ATALHO_PAINEL_WORKSPACES = EH_MAC ? "⌘⌥W" : "Ctrl+Alt+W";

/** ⌘⌥W (mac) / Ctrl+Alt+W: usa `code` (no mac, Option+W vira outro caractere em `key`). Sem Shift. */
export function ehAtalhoDoPainelWorkspaces(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, mac: boolean): boolean {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const letra = (e.code?.startsWith("Key") ? e.code.slice(3) : e.key).toLowerCase();
  return mod && e.altKey && !e.shiftKey && letra === "w";
}

/** Capturado ANTES do terminal para valer também com o foco dentro do xterm. */
export function ligarAtalhoPainelWorkspaces(
  store: StorePainelWorkspaces = storePainelWorkspaces,
  alvo: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  mac: boolean = EH_MAC,
): () => void {
  const f = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (k.defaultPrevented || k.repeat || !ehAtalhoDoPainelWorkspaces(k, mac)) return;
    k.preventDefault();
    k.stopPropagation();
    store.alternarFixado();
  };
  alvo.addEventListener("keydown", f, true);
  return () => alvo.removeEventListener("keydown", f, true);
}
