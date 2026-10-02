// Abertura do popover de limites, compartilhada entre o chip do topo e o medidor do rodapé.
import { useSyncExternalStore } from "react";

let aberto = false;
const ouvintes = new Set<() => void>();
const publicar = (v: boolean): void => { if (aberto === v) return; aberto = v; ouvintes.forEach((o) => o()); };

export const abrirPopoverLimites = (): void => publicar(true);
export const fecharPopoverLimites = (): void => publicar(false);
export const alternarPopoverLimites = (): void => publicar(!aberto);
export function usePopoverLimites(): boolean {
  return useSyncExternalStore((o) => { ouvintes.add(o); return () => void ouvintes.delete(o); }, () => aberto);
}
