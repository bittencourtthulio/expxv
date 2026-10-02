import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { EntradaMemoria } from "../../../compartilhado/memoria";
import { GLIFO_TIPO, ROTULO_FONTE, ROTULO_TIPO, haQuanto, janelaVisivel } from "./logica";

export const ALTURA_LINHA = 36;
export const ALTURA_PADRAO = 480;

export interface PropsTabela {
  itens: readonly EntradaMemoria[];
  selecionadaId: string | null;
  aoAbrir: (e: EntradaMemoria) => void;
  /** perto do fim da lista carregada: pede a próxima página. */
  aoFim: () => void;
  carregandoMais?: boolean;
  /** relógio injetável (teste). */
  agora?: () => Date;
  /** muda quando a lista é OUTRA (aba/filtro): volta ao topo. */
  resetar?: string;
  /** altura da janela quando ainda não medida (jsdom). */
  alturaPadrao?: number;
}

/**
 * Tabela virtualizada (`role="grid"`): só as linhas visíveis (mais 4 acima e abaixo) existem no DOM (P-40: ≤ 80 linhas com 5 000 entradas).
 * Teclado: setas, Home/End, PageUp/PageDown movem o foco entre linhas; Enter/Espaço abrem a gaveta. O texto é sempre renderizado COMO texto.
 */
export function TabelaMemoria({ itens, selecionadaId, aoAbrir, aoFim, carregandoMais = false, resetar = "", agora = () => new Date(), alturaPadrao = ALTURA_PADRAO }: PropsTabela) {
  const rolagem = useRef<HTMLDivElement>(null);
  const [topo, setTopo] = useState(0);
  const [altura, setAltura] = useState(alturaPadrao);
  const [foco, setFoco] = useState(0);
  const [deveFocar, setDeveFocar] = useState(false);
  const quadro = useRef(0);
  const total = itens.length;

  const medir = useCallback(() => {
    const el = rolagem.current;
    if (el !== null && el.clientHeight > 0) setAltura(el.clientHeight);
  }, []);
  useEffect(() => {
    medir();
    const el = rolagem.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, [medir]);
  useEffect(() => () => cancelAnimationFrame(quadro.current), []);

  const aoRolar = (): void => {
    if (quadro.current !== 0) return;
    quadro.current = requestAnimationFrame(() => {
      quadro.current = 0;
      const el = rolagem.current;
      if (el === null) return;
      setTopo(el.scrollTop);
      if (el.scrollTop + el.clientHeight >= total * ALTURA_LINHA - ALTURA_LINHA * 12) aoFim();
    });
  };
  // lista curta (cabe na janela) ou recém-carregada: pede mais enquanto o fim estiver à vista
  useEffect(() => { if (total > 0 && total * ALTURA_LINHA <= altura + ALTURA_LINHA * 12) aoFim(); }, [total, altura, aoFim]);
  // lista nova (filtro/aba): volta ao topo
  useEffect(() => { if (rolagem.current !== null) rolagem.current.scrollTop = 0; setTopo(0); setFoco(0); }, [resetar]);
  useEffect(() => { if (foco >= total && total > 0) setFoco(total - 1); }, [total, foco]);

  const { primeiro, ultimo } = janelaVisivel(topo, altura, total, ALTURA_LINHA);

  const irPara = (i: number): void => {
    const alvo = Math.max(0, Math.min(total - 1, i));
    const el = rolagem.current;
    if (el !== null) {
      const ini = alvo * ALTURA_LINHA;
      if (ini < el.scrollTop) el.scrollTop = ini;
      else if (ini + ALTURA_LINHA > el.scrollTop + altura) el.scrollTop = ini + ALTURA_LINHA - altura;
      setTopo(el.scrollTop);
    }
    setFoco(alvo);
    setDeveFocar(true);
  };
  useLayoutEffect(() => {
    if (!deveFocar) return;
    rolagem.current?.querySelector<HTMLElement>(`[data-i="${foco}"]`)?.focus();
    setDeveFocar(false);
  }, [deveFocar, foco, primeiro, ultimo]);

  const teclar = (e: KeyboardEvent<HTMLDivElement>, i: number, item: EntradaMemoria): void => {
    const pagina = Math.max(1, Math.floor(altura / ALTURA_LINHA) - 1);
    const alvo = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? total - 1 : e.key === "PageDown" ? i + pagina : e.key === "PageUp" ? i - pagina : null;
    if (alvo !== null) { e.preventDefault(); irPara(alvo); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aoAbrir(item); }
  };

  const relogio = agora();
  const linhas = [];
  for (let i = primeiro; i < ultimo; i++) {
    const e = itens[i] as EntradaMemoria;
    linhas.push(
      <div
        key={e.id}
        role="row"
        aria-rowindex={i + 2}
        aria-selected={e.id === selecionadaId}
        tabIndex={i === foco ? 0 : -1}
        data-i={i}
        className="mem-linha"
        style={{ top: i * ALTURA_LINHA }}
        onClick={() => { setFoco(i); aoAbrir(e); }}
        onFocus={() => setFoco(i)}
        onKeyDown={(ev) => teclar(ev, i, e)}
      >
        <div role="gridcell" className="mem-tipo-celula"><span className="mem-glifo" aria-hidden="true">{GLIFO_TIPO[e.tipo]}</span>{ROTULO_TIPO[e.tipo]}</div>
        <div role="gridcell" title={e.conteudo}>{e.conteudo.replace(/\s+/g, " ")}</div>
        <div role="gridcell">{ROTULO_FONTE[e.fonte]}</div>
        <div role="gridcell">{e.importancia === 5 ? <span className="mem-fixa" title="Fixada: fica fora da compactação e da retenção">5 fixa</span> : e.importancia}</div>
        <div role="gridcell" title={e.atualizado_em}>{haQuanto(e.atualizado_em, relogio)}</div>
        <div role="gridcell">{e.redigido ? <span className="mem-escudo" role="img" aria-label="Segredo mascarado nesta entrada" title="Segredo mascarado nesta entrada">⛨</span> : null}</div>
      </div>,
    );
  }

  return (
    <div className="mem-grade" role="grid" aria-label="Entradas da memória" aria-rowcount={total + 1} aria-colcount={6}>
      <div role="row" aria-rowindex={1} className="mem-linha mem-cab">
        <div role="columnheader">Tipo</div><div role="columnheader">Conteúdo</div><div role="columnheader">Origem</div><div role="columnheader">Imp.</div><div role="columnheader">Quando</div><div role="columnheader" aria-label="Mascarado" title="Segredo mascarado" />
      </div>
      <div ref={rolagem} className="mem-rolagem" onScroll={aoRolar} data-total={total}>
        <div style={{ height: total * ALTURA_LINHA, position: "relative" }}>{linhas}</div>
      </div>
      {carregandoMais ? <div className="mem-vazio" role="status" aria-busy="true">Carregando mais…</div> : null}
    </div>
  );
}
