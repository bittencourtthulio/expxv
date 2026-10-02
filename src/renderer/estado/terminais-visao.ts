// D-571: qual conjunto de terminais a tela mostra quando o dono pede "Sem projeto (N)" no seletor ou no painel de workspaces. Estado MÍNIMO e fora do store de terminais:
// só um booleano. Escolher qualquer workspace (seletor, painel, ⌘K, abrir projeto) sai do grupo "Sem projeto".
import { useSyncExternalStore } from "react";

export function criarStoreVisaoTerminais() {
  let semProjeto = false;
  const ouvintes = new Set<() => void>();
  const mudar = (v: boolean): void => { if (v !== semProjeto) { semProjeto = v; ouvintes.forEach((o) => o()); } };
  return {
    obter: (): boolean => semProjeto,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    entrarEmSemProjeto: (): void => mudar(true),
    sairDeSemProjeto: (): void => mudar(false),
  };
}
export type StoreVisaoTerminais = ReturnType<typeof criarStoreVisaoTerminais>;
export const storeVisaoTerminais: StoreVisaoTerminais = criarStoreVisaoTerminais();

export function useVisaoSemProjeto(store: StoreVisaoTerminais = storeVisaoTerminais): boolean {
  return useSyncExternalStore(store.assinar, store.obter);
}
