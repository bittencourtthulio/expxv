// Atalho ⌘⌥U / Ctrl+Alt+U (mostrar/ocultar o medidor de CPU e memória): um ouvinte de teclado barato; o comando da paleta (⌘K) faz o mesmo.
import { storeSistema } from "./sistema";

export const alternarMedidorSistema = (): void => { void storeSistema.alternarMostrar(); };

/** atalho → alterna? (puro): ⌘⌥U (mac) ou Ctrl+Alt+U (demais), sem Shift. */
export function ehAtalhoMedidorSistema(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, mac: boolean): boolean {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || !e.altKey || e.shiftKey) return false;
  const letra = (e.code?.startsWith("Key") ? e.code.slice(3) : e.key).toLowerCase();
  return letra === "u";
}

export function ligarAtalhoSistema(alvo: Pick<Window, "addEventListener" | "removeEventListener"> = window, mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "")): () => void {
  const f = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (!ehAtalhoMedidorSistema(k, mac)) return;
    k.preventDefault();
    alternarMedidorSistema();
  };
  alvo.addEventListener("keydown", f);
  return () => alvo.removeEventListener("keydown", f);
}
