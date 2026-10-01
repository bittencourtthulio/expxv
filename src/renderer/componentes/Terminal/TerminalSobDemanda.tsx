import { lazy, type ComponentType, type ReactElement } from "react";
import { moduloDoTerminalCarregado, precarregarTerminal } from "./carga";
import type { PropsTerminal } from "./Terminal";

const Preguicoso = lazy(() => precarregarTerminal().then((m) => ({ default: m.Terminal as ComponentType<PropsTerminal> })));

/**
 * O xterm vem em chunk próprio (P-08). Com o chunk já carregado em ocioso, monta direto: passar pelo
 * `lazy` mostraria o fallback e o React seguraria o conteúdo por ~300 ms (throttle de revelação do
 * Suspense), o que estourava o P-03 (abrir terminal ≤ 300 ms). Sem o chunk, cai no `lazy` (+ Suspense do chamador).
 */
export function TerminalSobDemanda(props: PropsTerminal): ReactElement {
  const pronto = moduloDoTerminalCarregado();
  if (pronto !== null) {
    const Real = pronto.Terminal as ComponentType<PropsTerminal>;
    return <Real {...props} />;
  }
  return <Preguicoso {...props} />;
}
