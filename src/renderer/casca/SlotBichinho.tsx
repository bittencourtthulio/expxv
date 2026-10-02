// Ponto de encaixe do Bichinho no menu (D-468). O chunk do bichinho só é pedido em ocioso, DEPOIS da primeira pintura (nada no JS inicial); até lá este
// componente rende nada. Falha de carga do chunk some em silêncio: o bichinho é enfeite vivo, nunca quebra a casca.
import { Component, lazy, memo, Suspense, useEffect, useState, type ReactNode } from "react";

/** O bichinho é enfeite: se o chunk falhar ao carregar (ou o desenho quebrar), some em silêncio sem derrubar o menu. */
class SomeEmSilencio extends Component<{ children: ReactNode }, { falhou: boolean }> {
  override state = { falhou: false };
  static getDerivedStateFromError(): { falhou: boolean } { return { falhou: true }; }
  override render(): ReactNode { return this.state.falhou ? null : this.props.children; }
}

const Slot = lazy(() => import("../bichinho/Slot"));
const Mini = lazy(() => import("../bichinho/Mini"));
const Camada = lazy(() => import("../bichinho/passeio/Camada"));

/** Atraso mínimo depois da montagem da casca antes de pedir o chunk (a pintura e os terminais têm prioridade). */
export const ATRASO_BICHINHO_MS = 1_200;

function useOciosoPronto(): boolean {
  const [pronto, setPronto] = useState(false);
  useEffect(() => {
    const ric = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    let t: ReturnType<typeof setTimeout> | undefined;
    const liberar = (): void => setPronto(true);
    t = setTimeout(() => { if (ric !== undefined) ric(liberar, { timeout: 2_000 }); else liberar(); }, ATRASO_BICHINHO_MS);
    return () => { if (t !== undefined) clearTimeout(t); t = undefined; };
  }, []);
  return pronto;
}

export const SlotBichinho = memo(function SlotBichinho({ recolhido }: { recolhido: boolean }) {
  if (!useOciosoPronto()) return null;
  return <SomeEmSilencio><Suspense fallback={null}><Slot recolhido={recolhido} /></Suspense></SomeEmSilencio>;
});

/** Encaixe do mini-bichinho no card de um workspace (painel de workspaces): mesmo chunk lazy, mesmo ocioso, mesma tolerância a falha. */
export const MiniBichinho = memo(function MiniBichinho({ workspaceId }: { workspaceId: string }) {
  if (!useOciosoPronto()) return null;
  return <SomeEmSilencio><Suspense fallback={null}><Mini workspaceId={workspaceId} /></Suspense></SomeEmSilencio>;
});

/** Camada do passeio dos bichinhos (D-650): montada UMA vez na casca, em ocioso depois da primeira pintura. Dentro dela só existe o detector de ociosidade (um timer) até
 * algum bichinho sair; sem passeio não renderiza nada. Mesmo chunk lazy do bichinho e mesma tolerância a falha. */
export const PasseioBichinhos = memo(function PasseioBichinhos() {
  if (!useOciosoPronto()) return null;
  return <SomeEmSilencio><Suspense fallback={null}><Camada /></Suspense></SomeEmSilencio>;
});
