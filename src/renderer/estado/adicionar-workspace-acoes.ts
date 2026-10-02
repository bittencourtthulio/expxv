// Atalho global do modal "Adicionar workspace" (⌘⇧O / Ctrl+Shift+O). Um ouvinte de teclado barato; o modal em si é lazy.
// O item de menu nativo "Abrir pasta…" (⌘O) e o comando da paleta continuam indo DIRETO ao diálogo nativo.
import { storeAdicionarWorkspace, type StoreAdicionar } from "./adicionar-workspace";

const EH_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const ATALHO_ADICIONAR_WORKSPACE = EH_MAC ? "⌘⇧O" : "Ctrl+Shift+O";

export function ehAtalhoAdicionarWorkspace(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, mac: boolean): boolean {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const letra = (e.code?.startsWith("Key") ? e.code.slice(3) : e.key).toLowerCase();
  return mod && e.shiftKey && !e.altKey && letra === "o";
}

/** Capturado ANTES do terminal para valer também com o foco dentro do xterm. */
export function ligarAtalhoAdicionarWorkspace(
  store: Pick<StoreAdicionar, "abrir"> = storeAdicionarWorkspace,
  alvo: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  mac: boolean = EH_MAC,
): () => void {
  const f = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (k.defaultPrevented || k.repeat || !ehAtalhoAdicionarWorkspace(k, mac)) return;
    k.preventDefault();
    k.stopPropagation();
    store.abrir("pasta");
  };
  alvo.addEventListener("keydown", f, true);
  return () => alvo.removeEventListener("keydown", f, true);
}
