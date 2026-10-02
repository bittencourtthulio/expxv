// Avisos transitórios (toasts) da casca: sem biblioteca. Quem avisa chama `avisar`; o <Avisos/> da casca mostra.
import { useSyncExternalStore } from "react";

export type TomAviso = "info" | "aviso" | "erro" | "sucesso";
export interface Aviso { id: number; texto: string; tom: TomAviso; acao?: { rotulo: string; executar: () => void } }

export const DURACAO_AVISO_MS = 8_000;
export const MAX_AVISOS = 4;

export function criarStoreAvisos(opcoes: { agendar?: (fn: () => void, ms: number) => void } = {}) {
  const agendar = opcoes.agendar ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms));
  const ouvintes = new Set<() => void>();
  let lista: readonly Aviso[] = [];
  let seq = 0;
  const publicar = (l: readonly Aviso[]): void => { lista = l; ouvintes.forEach((o) => o()); };
  const api = {
    obter: (): readonly Aviso[] => lista,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    avisar(texto: string, tom: TomAviso = "info", acao?: Aviso["acao"]): number {
      const id = ++seq;
      publicar([...lista, { id, texto, tom, ...(acao !== undefined ? { acao } : {}) }].slice(-MAX_AVISOS));
      agendar(() => api.fechar(id), DURACAO_AVISO_MS);
      return id;
    },
    fechar(id: number): void { if (lista.some((a) => a.id === id)) publicar(lista.filter((a) => a.id !== id)); },
  };
  return api;
}
export type StoreAvisos = ReturnType<typeof criarStoreAvisos>;
export const storeAvisos: StoreAvisos = criarStoreAvisos();
export const avisar = storeAvisos.avisar;
export function useAvisos(store: StoreAvisos = storeAvisos): readonly Aviso[] {
  return useSyncExternalStore(store.assinar, store.obter);
}
