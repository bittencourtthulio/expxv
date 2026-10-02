// Seletor de região (Fase 11, T-11.16 na versão in-app): mostra a imagem CONGELADA do display, mira em cruz de 1 px, leitor `x,y · WxH` e seleção por arrastar. Esc cancela; menos de 5×5 px
// cancela. Não cria janela nenhuma (nada para vazar): é um elemento do próprio renderer, desmontado ao confirmar/cancelar. Coordenadas devolvidas são LÓGICAS do display.
import { useEffect, useMemo, useRef, useState, type PointerEvent as EventoPonteiro, type ReactElement } from "react";
import type { RetanguloLogico } from "../../../compartilhado/captura";
import { ajustarContain, paraLogico, selecaoLogica, selecaoPequena, textoMira } from "./logica";

interface Props {
  /** URL (data:) da imagem congelada, já no tamanho lógico. */
  src: string;
  largura: number;
  altura: number;
  aoConfirmar(selecao: RetanguloLogico): void;
  aoCancelar(): void;
  /** testes: tamanho da área em px (jsdom não tem layout). */
  area?: { w: number; h: number };
}

export function SeletorRegiao({ src, largura, altura, aoConfirmar, aoCancelar, area }: Props): ReactElement {
  const raiz = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState(area ?? { w: typeof window === "undefined" ? largura : window.innerWidth, h: typeof window === "undefined" ? altura : window.innerHeight });
  const [mira, setMira] = useState<{ x: number; y: number } | null>(null);
  const [inicio, setInicioEstado] = useState<{ x: number; y: number } | null>(null);
  const inicioRef = useRef<{ x: number; y: number } | null>(null);
  const setInicio = (p: { x: number; y: number } | null): void => { inicioRef.current = p; setInicioEstado(p); }; // ref: o ponteiro pode disparar antes do próximo render
  useEffect(() => {
    if (area !== undefined) return;
    const aj = (): void => setTam({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", aj);
    return () => window.removeEventListener("resize", aj);
  }, [area]);
  useEffect(() => { raiz.current?.focus(); }, []);
  // Esc cancela de qualquer ponto (o foco pode estar em outro lugar)
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); aoCancelar(); } };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [aoCancelar]);

  const ajuste = useMemo(() => ajustarContain(tam.w, tam.h, largura, altura), [tam, largura, altura]);
  const local = (e: EventoPonteiro): { x: number; y: number } => {
    const r = raiz.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const sel = inicio !== null && mira !== null ? selecaoLogica(inicio, mira, ajuste, largura, altura) : null;
  const pontoLogico = mira === null ? { x: 0, y: 0 } : paraLogico(mira, ajuste, largura, altura);

  return (
    <div
      ref={raiz}
      className="cap-seletor"
      role="dialog"
      aria-modal="true"
      aria-label="Selecionar região da captura. Arraste para escolher, Esc cancela."
      tabIndex={-1}
      onPointerDown={(e) => { if (e.button !== 0) return; const p = local(e); setInicio(p); setMira(p); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => setMira(local(e))}
      onPointerUp={(e) => {
        const ini = inicioRef.current;
        if (ini === null) return;
        const fim = local(e);
        const s = selecaoLogica(ini, fim, ajuste, largura, altura);
        setInicio(null);
        if (selecaoPequena(s)) { aoCancelar(); return; } // < 5×5 px cancela
        aoConfirmar(s);
      }}
      onPointerCancel={() => { setInicio(null); aoCancelar(); }}
    >
      <img className="cap-imagem" src={src} alt="" draggable={false} style={{ left: ajuste.x, top: ajuste.y, width: largura * ajuste.escala, height: altura * ajuste.escala }} />
      {mira !== null ? (
        <>
          <span className="cap-mira-h" aria-hidden="true" style={{ top: mira.y }} />
          <span className="cap-mira-v" aria-hidden="true" style={{ left: mira.x }} />
          <span className="cap-leitor" aria-hidden="true" style={{ left: Math.min(mira.x + 12, tam.w - 130), top: Math.min(mira.y + 12, tam.h - 22) }}>{textoMira(pontoLogico, sel)}</span>
        </>
      ) : null}
      {inicio !== null && mira !== null ? (
        <span className="cap-selecao" aria-hidden="true" style={{ left: Math.min(inicio.x, mira.x), top: Math.min(inicio.y, mira.y), width: Math.abs(mira.x - inicio.x), height: Math.abs(mira.y - inicio.y) }} />
      ) : null}
      <span className="cap-dica" role="status">Arraste para selecionar · Esc cancela</span>
    </div>
  );
}
