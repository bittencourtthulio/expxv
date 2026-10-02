// Ganchos das "casas": o lugar de origem de cada bichinho (slot do menu, mini do cartão). Registram o elemento no controlador e dizem se o
// bichinho está passeando (então a casa mostra a casinha vazia). Sem estado próprio além da assinatura: custo zero com todos no posto.
import { useEffect, useSyncExternalStore, type RefObject } from "react";
import { controlePadrao, type ControlePasseio } from "./controle";
import "./passeio.css";

export function useCasa(chave: string, workspaceId: string | null, ref: RefObject<HTMLElement | null>, controle: ControlePasseio = controlePadrao()): void {
  useEffect(() => {
    if (workspaceId === null) return;
    return controle.registrarCasa({ chave, workspaceId, elemento: () => ref.current });
  }, [controle, chave, workspaceId, ref]);
}

export function useForaDoPosto(chave: string, controle: ControlePasseio = controlePadrao()): boolean {
  return useSyncExternalStore(controle.assinar, () => controle.obterFora().has(chave));
}

/** A casinha vazia que fica no lugar do bichinho enquanto ele passeia: contorno tracejado e duas pegadas. Decorativa. */
export function Casinha(): React.ReactElement {
  return <span className="pb-casinha" aria-hidden="true" data-casinha />;
}
