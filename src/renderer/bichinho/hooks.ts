// Ganchos de custo ocioso zero: nada roda sem reação. `useJanelaOculta` pausa as animações com a janela escondida; `useEspiar` é o "passeio raro"
// (um olhar em volta de 1,8 s a cada 2–5 minutos, só parado, visível e com animações permitidas).
import { useEffect, useRef, useState } from "react";

export const ESPIAR_MIN_MS = 2 * 60_000;
export const ESPIAR_MAX_MS = 5 * 60_000;
export const ESPIAR_DURACAO_MS = 1_800;

export function useJanelaOculta(): boolean {
  const [oculta, setOculta] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  useEffect(() => {
    const ao = (): void => setOculta(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", ao);
    return () => document.removeEventListener("visibilitychange", ao);
  }, []);
  return oculta;
}

export function movimentoReduzido(): boolean {
  try { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export function useEspiar(ativo: boolean, sorteio: () => number = Math.random): boolean {
  const [espiando, setEspiando] = useState(false);
  const sorteioRef = useRef(sorteio);
  sorteioRef.current = sorteio;
  useEffect(() => {
    if (!ativo || movimentoReduzido()) { setEspiando(false); return; }
    let t: ReturnType<typeof setTimeout> | undefined;
    const agendar = (): void => {
      t = setTimeout(() => {
        if (document.visibilityState === "hidden") { agendar(); return; }
        setEspiando(true);
        t = setTimeout(() => { setEspiando(false); agendar(); }, ESPIAR_DURACAO_MS);
      }, ESPIAR_MIN_MS + sorteioRef.current() * (ESPIAR_MAX_MS - ESPIAR_MIN_MS));
    };
    agendar();
    return () => { if (t !== undefined) clearTimeout(t); setEspiando(false); };
  }, [ativo]);
  return espiando;
}
