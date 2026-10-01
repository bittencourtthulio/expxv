import type { ApiAde } from "../compartilhado/ipc";

/** API tipada do preload (`window.ade`), ou undefined fora do Electron (testes, navegador). */
export function ade(): ApiAde | undefined {
  return (globalThis as unknown as { ade?: ApiAde }).ade;
}
