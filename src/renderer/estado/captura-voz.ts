// Indicadores discretos do rodapé (Fase 11): "● mic" SÓ enquanto grava e `● 12/60 · 2 fps` durante a gravação por quadros. Uma assinatura leve, ligada pelo próprio rodapé;
// ocioso não mostra nada. Nada de conteúdo de fala nem de imagem passa por aqui: só estado e contagem.
import { useSyncExternalStore } from "react";
import { ade } from "../ade";

export interface IndicadoresCapturaVoz { mic: boolean; quadros: { n: number; max: number; fps: number } | null }
const VAZIO: IndicadoresCapturaVoz = { mic: false, quadros: null };
let estado: IndicadoresCapturaVoz = VAZIO;
const ouvintes = new Set<() => void>();
const mudar = (novo: IndicadoresCapturaVoz): void => { estado = novo; ouvintes.forEach((o) => o()); };

let desligar: (() => void) | null = null;
export function ligarIndicadoresCapturaVoz(): () => void {
  if (desligar !== null) return desligar;
  const a = ade();
  if (a?.voz === undefined && a?.captura === undefined) return () => undefined;
  const off1 = a.voz?.assinar((e) => { if (e.tipo === "estado") mudar({ ...estado, mic: e.ditado === "gravando" }); });
  const off2 = a.captura?.assinar((e) => {
    if (e.tipo === "quadros_progresso") mudar({ ...estado, quadros: { n: e.quadros, max: e.maximo, fps: e.fps } });
    else if (e.tipo === "quadros_fim") mudar({ ...estado, quadros: null });
  });
  desligar = () => { off1?.(); off2?.(); desligar = null; mudar(VAZIO); };
  return desligar;
}

export function useIndicadoresCapturaVoz(): IndicadoresCapturaVoz {
  return useSyncExternalStore((cb) => { ouvintes.add(cb); return () => void ouvintes.delete(cb); }, () => estado, () => VAZIO);
}
