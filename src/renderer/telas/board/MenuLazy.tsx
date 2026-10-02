import { useState, type ReactNode } from "react";

export interface PropsMenuLazy {
  className?: string;
  /** conteúdo do `<summary>` (a legenda do botão). */
  titulo: ReactNode;
  tituloAttr?: string;
  ariaLabel?: string;
  /** painel só existe no DOM enquanto o menu está aberto (P-116: elementos de menus fechados não contam). */
  children: ReactNode;
}
/** `<details>` controlado: abre/fecha por clique ou teclado no `<summary>` (nativo) e só monta o painel aberto. */
export function MenuLazy({ className = "bd-menu", titulo, tituloAttr, ariaLabel, children }: PropsMenuLazy) {
  const [aberto, setAberto] = useState(false);
  return (
    <details className={className} open={aberto}>
      <summary title={tituloAttr} aria-label={ariaLabel} onClick={(e) => { e.preventDefault(); setAberto((a) => !a); }}>{titulo}</summary>
      {aberto ? children : null}
    </details>
  );
}
