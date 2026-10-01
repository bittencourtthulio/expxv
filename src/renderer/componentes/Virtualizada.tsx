import "./componentes.css";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface PropsVirtualizada<T> {
  itens: readonly T[];
  /** altura fixa de cada item, em px. */
  alturaItem: number;
  chave: (item: T, indice: number) => string;
  renderizar: (item: T, indice: number) => ReactNode;
  rotulo: string;
  /** itens extras renderizados acima e abaixo da janela. */
  margem?: number;
  /** altura da janela quando ainda não medida (jsdom, primeira pintura). */
  alturaPadrao?: number;
}

/** Lista virtualizada própria: só os itens visíveis (mais a margem) existem no DOM (P-09). */
export function Virtualizada<T>({ itens, alturaItem, chave, renderizar, rotulo, margem = 4, alturaPadrao = 480 }: PropsVirtualizada<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [topo, setTopo] = useState(0);
  const [altura, setAltura] = useState(alturaPadrao);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const medir = () => { if (el.clientHeight > 0) setAltura(el.clientHeight); };
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const aoRolar = useCallback(() => { if (ref.current !== null) setTopo(ref.current.scrollTop); }, []);

  const primeiro = Math.max(0, Math.floor(topo / alturaItem) - margem);
  const ultimo = Math.min(itens.length, Math.ceil((topo + altura) / alturaItem) + margem);
  const visiveis: ReactNode[] = [];
  for (let i = primeiro; i < ultimo; i++) {
    const item = itens[i] as T;
    visiveis.push(
      <div key={chave(item, i)} role="listitem" className="virtualizada-item" style={{ top: i * alturaItem, height: alturaItem }} aria-posinset={i + 1} aria-setsize={itens.length}>
        {renderizar(item, i)}
      </div>,
    );
  }
  return (
    <div ref={ref} className="virtualizada" role="list" aria-label={rotulo} onScroll={aoRolar} tabIndex={0}>
      <div className="virtualizada-corpo" style={{ height: itens.length * alturaItem }}>{visiveis}</div>
    </div>
  );
}
