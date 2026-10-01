import "./componentes.css";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCAVEIS = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface PropsDialogo {
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
  largura?: number;
}

/** Diálogo próprio (nunca window.confirm): role="dialog", foco preso, Esc fecha, foco volta a quem abriu. */
export function Dialogo({ titulo, aoFechar, children, largura = 520 }: PropsDialogo) {
  const idTitulo = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const el = caixa.current;
    const foco = el?.querySelector<HTMLElement>("[data-foco-inicial]") ?? el?.querySelector<HTMLElement>(FOCAVEIS) ?? el;
    foco?.focus();
    return () => { if (anterior?.isConnected) anterior.focus(); };
  }, []);

  const aoTeclar = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); fechar.current(); return; }
    if (e.key !== "Tab" || caixa.current === null) return;
    const itens = [...caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS)];
    if (itens.length === 0) { e.preventDefault(); return; }
    const primeiro = itens[0] as HTMLElement;
    const ultimo = itens[itens.length - 1] as HTMLElement;
    const ativo = document.activeElement;
    if (e.shiftKey && (ativo === primeiro || ativo === caixa.current)) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && ativo === ultimo) { e.preventDefault(); primeiro.focus(); }
  };

  return createPortal(
    <div className="dialogo-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) fechar.current(); }}>
      <div ref={caixa} className="dialogo" role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1} style={{ width: `min(${largura}px, 92vw)` }} onKeyDown={aoTeclar}>
        <h2 id={idTitulo} className="dialogo-titulo">{titulo}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export interface PropsConfirmacao {
  titulo: string;
  texto: ReactNode;
  rotuloConfirmar: string;
  perigoso?: boolean;
  ocupado?: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}

/** Confirmação pela UI. O foco inicial fica em "Cancelar" (o caminho seguro). */
export function DialogoConfirmacao({ titulo, texto, rotuloConfirmar, perigoso = false, ocupado = false, aoConfirmar, aoCancelar }: PropsConfirmacao) {
  return (
    <Dialogo titulo={titulo} aoFechar={aoCancelar}>
      <div className="dialogo-corpo">{texto}</div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" data-foco-inicial onClick={aoCancelar}>Cancelar</button>
        <button type="button" className={perigoso ? "botao botao-perigo" : "botao botao-primario"} disabled={ocupado} onClick={aoConfirmar}>{rotuloConfirmar}</button>
      </div>
    </Dialogo>
  );
}
