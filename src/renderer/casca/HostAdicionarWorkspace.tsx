import { lazy, Suspense } from "react";
import { storeAdicionarWorkspace, useAdicionarWorkspace, type StoreAdicionar } from "../estado/adicionar-workspace";

// O modal (e o CSS dele) só entram no JS quando alguém abre: nada no boot.
const Modal = lazy(() => import("../telas/adicionar-workspace/ModalAdicionarWorkspace"));

/** Monta o modal "Adicionar workspace" só enquanto aberto. Um único host na casca (App). */
export function HostAdicionarWorkspace({ store = storeAdicionarWorkspace }: { store?: StoreAdicionar }) {
  const ui = useAdicionarWorkspace(store);
  if (!ui.aberto) return null;
  return (
    <Suspense fallback={null}>
      <Modal store={store} />
    </Suspense>
  );
}
