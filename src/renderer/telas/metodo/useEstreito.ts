import { useEffect, useState } from "react";

export const LARGURA_ESTREITA = 1100;
const CONSULTA = `(max-width: ${LARGURA_ESTREITA - 1}px)`;

/** Janela abaixo de 1100 px: a coluna lateral de gestos vira uma faixa acima do composer. Sem matchMedia (testes), vale o largo. */
export function useEstreito(): boolean {
  const [estreito, setEstreito] = useState(() => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(CONSULTA).matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(CONSULTA);
    const mudou = (): void => setEstreito(mq.matches);
    mudou();
    mq.addEventListener?.("change", mudou);
    return () => mq.removeEventListener?.("change", mudou);
  }, []);
  return estreito;
}
