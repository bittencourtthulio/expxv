import { useRef, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import type { Orientacao } from "./layout";

export const RAZAO_MIN = 0.1;
export const RAZAO_MAX = 0.9;
export const PASSO_TECLADO = 0.05;

export const limitarRazao = (r: number): number => Math.min(RAZAO_MAX, Math.max(RAZAO_MIN, Number.isFinite(r) ? r : 0.5));

interface Props {
  orientacao: Orientacao;
  razao: number;
  /** caixa que contém os dois painéis (para converter o ponteiro em razão). */
  caixa: React.RefObject<HTMLElement | null>;
  aoMudar(razao: number): void;
  /** D-570: o gesto terminou (soltou o ponteiro ou tecla): é aqui que a proporção é guardada, sem re-render a cada movimento. */
  aoSoltar?(razao: number): void;
  rotulo?: string;
}

/**
 * Separador arrastável e operável por teclado (role="separator"). "vertical" = painéis lado a lado
 * (a linha é vertical); "horizontal" = um em cima do outro.
 */
export function Divisor({ orientacao, razao, caixa, aoMudar, aoSoltar, rotulo = "Redimensionar painéis" }: Props): ReactElement {
  const arrastando = useRef(false);
  const ultima = useRef(razao);
  ultima.current = razao;
  const mudar = (r: number): void => { ultima.current = r; aoMudar(r); };
  const lado = orientacao === "vertical";
  const mover = (e: PointerEvent<HTMLDivElement>): void => {
    if (!arrastando.current || caixa.current === null) return;
    const r = caixa.current.getBoundingClientRect();
    const total = lado ? r.width : r.height;
    if (total <= 0) return;
    mudar(limitarRazao(((lado ? e.clientX - r.left : e.clientY - r.top)) / total));
  };
  const teclar = (e: KeyboardEvent<HTMLDivElement>): void => {
    const menos = lado ? "ArrowLeft" : "ArrowUp";
    const mais = lado ? "ArrowRight" : "ArrowDown";
    if (e.key === menos) mudar(limitarRazao(razao - PASSO_TECLADO));
    else if (e.key === mais) mudar(limitarRazao(razao + PASSO_TECLADO));
    else if (e.key === "Home") mudar(RAZAO_MIN);
    else if (e.key === "End") mudar(RAZAO_MAX);
    else if (e.key === "Enter") mudar(0.5);
    else return;
    aoSoltar?.(ultima.current);
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      className="terminais-divisor"
      data-orientacao={orientacao}
      role="separator"
      aria-label={rotulo}
      aria-orientation={lado ? "vertical" : "horizontal"}
      aria-valuemin={Math.round(RAZAO_MIN * 100)}
      aria-valuemax={Math.round(RAZAO_MAX * 100)}
      aria-valuenow={Math.round(razao * 100)}
      tabIndex={0}
      onPointerDown={(e) => { arrastando.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); }}
      onPointerMove={mover}
      onPointerUp={(e) => { const era = arrastando.current; arrastando.current = false; e.currentTarget.releasePointerCapture?.(e.pointerId); if (era) aoSoltar?.(ultima.current); }}
      onPointerCancel={() => { arrastando.current = false; }}
      onKeyDown={teclar}
    />
  );
}
