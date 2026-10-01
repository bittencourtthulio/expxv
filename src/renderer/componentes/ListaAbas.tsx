import type { KeyboardEvent, ReactElement, ReactNode } from "react";

export const idAba = (base: string, id: string): string => `${base}-aba-${id}`;
export const idPainel = (base: string): string => `${base}-painel`;

export interface DefAba<T extends string> { id: T; rotulo: ReactNode }

/**
 * Abas acessíveis (padrão WAI-ARIA, ativação automática): `role=tablist`, tabindex "roving" (só a aba ativa entra na
 * sequência do Tab), setas/Home/End movem o foco e a seleção. O painel usa `idPainel(base)` e `aria-labelledby={idAba(base, ativa)}`.
 */
export function ListaAbas<T extends string>({ abas, ativa, aoMudar, rotulo, base, className }: {
  abas: readonly DefAba<T>[];
  ativa: T;
  aoMudar: (id: T) => void;
  rotulo: string;
  base: string;
  className?: string;
}): ReactElement {
  const teclar = (e: KeyboardEvent<HTMLElement>, i: number): void => {
    const n = abas.length;
    const alvo = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (alvo < 0) return;
    e.preventDefault();
    const proxima = abas[alvo];
    if (proxima === undefined) return;
    aoMudar(proxima.id);
    document.getElementById(idAba(base, proxima.id))?.focus();
  };
  return (
    <div role="tablist" aria-label={rotulo} className={className}>
      {abas.map((a, i) => (
        <button
          key={a.id}
          type="button"
          role="tab"
          id={idAba(base, a.id)}
          aria-selected={a.id === ativa}
          aria-controls={idPainel(base)}
          tabIndex={a.id === ativa ? 0 : -1}
          onClick={() => aoMudar(a.id)}
          onKeyDown={(e) => teclar(e, i)}
        >
          {a.rotulo}
        </button>
      ))}
    </div>
  );
}
