import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from "react";
import type { BoardModelo, CardBoard, ColunaBoard, InfoWip } from "../../../compartilhado/custo";
import { chaveFaixa, linhasDaColuna, type Agrupamento, type LinhaColuna } from "./agrupar";
import { ALTURA_CARD, CardLinha } from "./CardLinha";
import { ehSeta, focarLinha, proximaPosicao } from "./foco";
import { COLUNAS_BOARD, GLIFO_COLUNA, ROTULO_COLUNA } from "./rotulos";

interface PropsColuna {
  idx: number;
  coluna: ColunaBoard;
  linhas: readonly LinhaColuna[];
  total: number;
  wip: InfoWip;
  selecionada: string | null;
  aoAbrir: (c: CardBoard) => void;
  aoFaixa: (chave: string) => void;
}

const rotuloColuna = (coluna: ColunaBoard, total: number, wip: InfoWip): string =>
  `${ROTULO_COLUNA[coluna]}, ${total} ${total === 1 ? "card" : "cards"}${wip.limite !== null ? `, limite ${wip.limite}${wip.excedido ? " excedido" : ""}` : ""}`;

/** altura da janela antes da 1ª medida (jsdom, 1ª pintura): pequena de propósito, a medida real (`clientHeight`) a substitui no layout. */
const ALTURA_PADRAO = 260;
const MARGEM = 1;

interface PropsLista {
  linhas: readonly LinhaColuna[];
  rotulo: string;
  selecionada: string | null;
  aoAbrir: (c: CardBoard) => void;
  aoFaixa: (chave: string) => void;
}
/** Lista virtualizada própria da coluna: um elemento por linha (sem wrappers) e um pseudo-elemento de altura total no lugar do espaçador (P-116). */
export function ListaColuna({ linhas, rotulo, selecionada, aoAbrir, aoFaixa }: PropsLista) {
  const ref = useRef<HTMLDivElement>(null);
  const [topo, setTopo] = useState(0);
  const [altura, setAltura] = useState(ALTURA_PADRAO);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const medir = (): void => { if (el.clientHeight > 0) setAltura(el.clientHeight); };
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const primeiro = Math.max(0, Math.floor(topo / ALTURA_CARD) - MARGEM);
  const ultimo = Math.min(linhas.length, Math.ceil((topo + altura) / ALTURA_CARD) + MARGEM);
  const visiveis: ReactElement[] = [];
  for (let i = primeiro; i < ultimo; i++) {
    const l = linhas[i] as LinhaColuna;
    visiveis.push(
      l.tipo === "faixa" ? (
        <button key={l.chave} type="button" className="bd-faixa" data-pos={i} aria-expanded={!l.recolhida} style={{ top: i * ALTURA_CARD, height: ALTURA_CARD }} onClick={() => aoFaixa(l.chave)}>
          {l.recolhida ? "▸" : "▾"} {l.rotulo} · {l.total}
        </button>
      ) : (
        <CardLinha key={l.chave} card={l.card} selecionado={l.card.chave === selecionada} aoAbrir={aoAbrir} indice={i} tamanho={linhas.length} />
      ),
    );
  }
  return (
    <div ref={ref} className="bd-lista-col" role="group" aria-label={rotulo} data-lista="" style={{ "--bd-altura": `${linhas.length * ALTURA_CARD}px` } as CSSProperties} onScroll={() => { if (ref.current !== null) setTopo(ref.current.scrollTop); }}>
      {visiveis}
    </div>
  );
}

/** Uma coluna: 3 elementos fixos (região, cabeçalho, lista). Glifo, contagem e WIP do cabeçalho saem por CSS (data-*); `memo`: só re-renderiza se as linhas, o WIP ou a seleção mudarem. */
const ColunaView = memo(function ColunaView({ idx, coluna, linhas, total, wip, selecionada, aoAbrir, aoFaixa }: PropsColuna) {
  return (
    <section className="bd-coluna" role="region" aria-label={rotuloColuna(coluna, total, wip)} data-coluna={coluna} data-coluna-idx={idx}>
      <h3
        className="bd-coluna-cab"
        data-glifo={GLIFO_COLUNA[coluna]}
        data-n={total}
        data-wip={wip.limite !== null ? `${wip.excedido ? "▲ " : ""}${wip.total}/${wip.limite}` : undefined}
        data-excedido={wip.excedido || undefined}
        title={wip.limite !== null ? "Limite de trabalho em andamento (só informa; nada é bloqueado)" : undefined}
      >
        {ROTULO_COLUNA[coluna]}
      </h3>
      {linhas.length === 0 ? <p className="bd-coluna-vazia">vazia</p> : <ListaColuna linhas={linhas} rotulo={`Cards ${ROTULO_COLUNA[coluna]}`} selecionada={selecionada} aoAbrir={aoAbrir} aoFaixa={aoFaixa} />}
    </section>
  );
});

export interface PropsColunas {
  modelo: BoardModelo;
  agrupar: Agrupamento;
  recolhidas: ReadonlySet<string>;
  selecionada: string | null;
  aoAbrir: (c: CardBoard) => void;
  aoFaixa: (chave: string) => void;
}

/** As seis colunas do Board; setas movem o foco (↑↓ no card, ←→ de coluna). Sem arrastar: nenhum card muda de coluna por gesto (D-107). */
export function Colunas({ modelo, agrupar, recolhidas, selecionada, aoAbrir, aoFaixa }: PropsColunas) {
  const raiz = useRef<HTMLDivElement>(null);
  const linhas = useMemo(() => COLUNAS_BOARD.map((c) => linhasDaColuna(modelo.colunas[c], agrupar, recolhidas)), [modelo.colunas, agrupar, recolhidas]);
  const aoFaixaRef = useRef(aoFaixa);
  aoFaixaRef.current = aoFaixa;
  const faixaEstavel = useCallback((k: string) => aoFaixaRef.current(k), []);

  const teclar = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!ehSeta(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const alvo = e.target as HTMLElement;
    if (!alvo.matches?.(".bd-card, .bd-faixa")) return;
    const col = alvo.closest<HTMLElement>("[data-coluna-idx]");
    const item = alvo.closest<HTMLElement>("[data-pos]");
    if (col === null || item === null) return;
    const atual = { coluna: Number(col.dataset["colunaIdx"]), indice: Number(item.dataset["pos"]) };
    const prox = proximaPosicao(atual, e.key, linhas.map((l) => l.length));
    if (prox.coluna === atual.coluna && prox.indice === atual.indice) return;
    e.preventDefault();
    if (raiz.current !== null) focarLinha(raiz.current, prox.coluna, prox.indice, ALTURA_CARD);
  };

  return (
    <div ref={raiz} className="bd-colunas" onKeyDown={teclar}>
      {COLUNAS_BOARD.map((c, i) => (
        <ColunaView key={c} idx={i} coluna={c} linhas={linhas[i] ?? []} total={modelo.colunas[c].length} wip={modelo.wip[c]} selecionada={selecionada !== null && modelo.colunas[c].some((x) => x.chave === selecionada) ? selecionada : null} aoAbrir={aoAbrir} aoFaixa={faixaEstavel} />
      ))}
    </div>
  );
}
export { chaveFaixa };
