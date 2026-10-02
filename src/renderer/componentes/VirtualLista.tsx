import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import "./VirtualLista.css";

interface Props<T> {
  itens: readonly T[];
  /** altura fixa de cada linha, em px. */
  alturaItem: number;
  /** altura da janela quando o elemento ainda não foi medido (jsdom, primeira pintura). */
  alturaPadrao?: number;
  rotulo: string;
  chave: (item: T, indice: number) => string;
  renderItem: (item: T, indice: number) => ReactNode;
  className?: string;
  /** linhas extras renderizadas acima e abaixo da janela. */
  extra?: number;
  /** Pede para rolar até o índice (cada pedido novo precisa de `n` diferente). */
  rolarPara?: { indice: number; n: number } | undefined;
}

/** Lista virtualizada de altura fixa: só as linhas visíveis (mais `extra`) existem no DOM. */
export function VirtualLista<T>({ itens, alturaItem, alturaPadrao = 400, rotulo, chave, renderItem, className = "", extra = 4, rolarPara }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [topo, setTopo] = useState(0);
  const [altura, setAltura] = useState(alturaPadrao);
  const quadro = useRef(0);

  const medir = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientHeight > 0) setAltura(el.clientHeight);
  }, []);

  useEffect(() => {
    medir();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, [medir]);

  useEffect(() => () => cancelAnimationFrame(quadro.current), []);

  useEffect(() => {
    if (rolarPara === undefined || !ref.current) return;
    ref.current.scrollTop = rolarPara.indice * alturaItem;
    setTopo(rolarPara.indice * alturaItem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolarPara?.n]);

  const aoRolar = () => {
    if (quadro.current) return;
    quadro.current = requestAnimationFrame(() => {
      quadro.current = 0;
      if (ref.current) setTopo(ref.current.scrollTop);
    });
  };

  const total = itens.length;
  const primeiro = Math.max(0, Math.floor(topo / alturaItem) - extra);
  const ultimo = Math.min(total, Math.ceil((topo + altura) / alturaItem) + extra);
  const visiveis: ReactNode[] = [];
  for (let i = primeiro; i < ultimo; i++) {
    const item = itens[i] as T;
    visiveis.push(
      <div
        key={chave(item, i)}
        role="listitem"
        aria-setsize={total}
        aria-posinset={i + 1}
        className="virtual-linha"
        style={{ position: "absolute", top: i * alturaItem, left: 0, right: 0, height: alturaItem }}
      >
        {renderItem(item, i)}
      </div>,
    );
  }

  return (
    <div ref={ref} className={`virtual-lista ${className}`.trim()} role="list" aria-label={rotulo} onScroll={aoRolar} style={{ overflowY: "auto", position: "relative", minHeight: 0 }} data-total={total}>
      <div style={{ height: total * alturaItem, position: "relative" }}>{visiveis}</div>
    </div>
  );
}
