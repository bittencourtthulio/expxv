// Tabela virtualizada do Catálogo (T-07.27): role="grid" com linhas de 24 px; só as linhas visíveis (≤ 80) existem no DOM. Cada linha é
// navegável por teclado (setas/Home/End movem, Enter ou Espaço abre a gaveta). Badge de CLI sempre com símbolo + texto (cor nunca é o único sinal).
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ItemCatalogo } from "../../../compartilhado/catalogo";
import { ALTURA_LINHA, badgeDe, CLIS, MAX_LINHAS_DOM, ROTULO_ORIGEM, rotuloCli, type LinhaTabela } from "./logica";

const EXTRA = 4;

interface Props {
  linhas: readonly LinhaTabela[];
  rotulo: string;
  selecionado: string | null;
  aoAbrir: (id: string) => void;
  aoAlternarGrupo: (rotulo: string) => void;
  alturaPadrao?: number;
}

export function Tabela({ linhas, rotulo, selecionado, aoAbrir, aoAlternarGrupo, alturaPadrao = 560 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [topo, setTopo] = useState(0);
  const [altura, setAltura] = useState(alturaPadrao);
  const [foco, setFoco] = useState(0);
  const [pedirFoco, setPedirFoco] = useState(0);
  const quadro = useRef(0);

  const medir = useCallback(() => { const el = ref.current; if (el !== null && el.clientHeight > 0) setAltura(el.clientHeight); }, []);
  useEffect(() => {
    medir();
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") return undefined;
    const o = new ResizeObserver(medir);
    o.observe(el);
    return () => o.disconnect();
  }, [medir]);
  useEffect(() => () => cancelAnimationFrame(quadro.current), []);

  const aoRolar = () => {
    if (quadro.current !== 0) return;
    quadro.current = requestAnimationFrame(() => { quadro.current = 0; if (ref.current !== null) setTopo(ref.current.scrollTop); });
  };

  const total = linhas.length;
  const focoValido = Math.min(foco, Math.max(0, total - 1));
  const primeiro = Math.max(0, Math.floor(topo / ALTURA_LINHA) - EXTRA);
  const ultimo = Math.min(total, Math.ceil((topo + altura) / ALTURA_LINHA) + EXTRA, primeiro + MAX_LINHAS_DOM);

  // depois de mover o foco por teclado, a linha alvo é renderizada (rolagem) e então focada
  useEffect(() => {
    if (pedirFoco === 0) return;
    const el = ref.current?.querySelector<HTMLElement>(`[data-indice="${focoValido}"]`);
    el?.focus();
  }, [pedirFoco, focoValido]);

  const mover = (para: number) => {
    const alvo = Math.max(0, Math.min(total - 1, para));
    setFoco(alvo);
    const el = ref.current;
    if (el !== null) {
      const y = alvo * ALTURA_LINHA;
      if (y < el.scrollTop) { el.scrollTop = y; setTopo(y); }
      else if (y + ALTURA_LINHA > el.scrollTop + altura) { el.scrollTop = y + ALTURA_LINHA - altura; setTopo(el.scrollTop); }
    }
    setPedirFoco((n) => n + 1);
  };

  const aoTeclar = (e: KeyboardEvent, i: number, l: LinhaTabela) => {
    if (e.key === "ArrowDown") { e.preventDefault(); mover(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); mover(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); mover(0); }
    else if (e.key === "End") { e.preventDefault(); mover(total - 1); }
    else if (e.key === "PageDown") { e.preventDefault(); mover(i + Math.max(1, Math.floor(altura / ALTURA_LINHA) - 1)); }
    else if (e.key === "PageUp") { e.preventDefault(); mover(i - Math.max(1, Math.floor(altura / ALTURA_LINHA) - 1)); }
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (l.tipo === "grupo") aoAlternarGrupo(l.rotulo); else aoAbrir(l.item.id);
    }
  };

  const visiveis = [];
  for (let i = primeiro; i < ultimo; i++) {
    const l = linhas[i] as LinhaTabela;
    const posicao = { position: "absolute" as const, top: i * ALTURA_LINHA, left: 0, right: 0, height: ALTURA_LINHA };
    if (l.tipo === "grupo") {
      visiveis.push(
        <div key={l.chave} role="row" aria-rowindex={i + 2} aria-expanded={!l.recolhido} className="cat-linha cat-grupo" style={posicao} tabIndex={i === focoValido ? 0 : -1} data-indice={i}
          onKeyDown={(e) => aoTeclar(e, i, l)} onFocus={() => setFoco(i)} onClick={() => aoAlternarGrupo(l.rotulo)}>
          <div role="gridcell" aria-colspan={2 + CLIS.length} className="cat-celula cat-grupo-nome"><span aria-hidden="true">{l.recolhido ? "▸" : "▾"}</span> {l.rotulo} <span className="cat-contagem-grupo">({l.n})</span></div>
        </div>,
      );
      continue;
    }
    const it: ItemCatalogo = l.item;
    visiveis.push(
      <div key={l.chave} role="row" aria-rowindex={i + 2} aria-selected={it.id === selecionado} className="cat-linha" data-selecionado={it.id === selecionado || undefined} style={posicao}
        tabIndex={i === focoValido ? 0 : -1} data-indice={i} data-item-id={it.id} aria-label={`${it.nome}: detalhes`}
        onKeyDown={(e) => aoTeclar(e, i, l)} onFocus={() => setFoco(i)} onClick={() => aoAbrir(it.id)}>
        <div role="gridcell" className="cat-celula cat-nome" title={it.nome}>{it.nome}{it.plugin !== null ? <span className="cat-plugin"> · {it.plugin}</span> : null}</div>
        <div role="gridcell" className="cat-celula cat-origem"><span className="cat-selo" data-origem={it.origem}>{ROTULO_ORIGEM[it.origem]}</span>{it.variantes > 1 ? <span className="cat-selo" data-tom="aviso" title="Conteúdo diferente entre CLIs">variantes {it.variantes}</span> : null}</div>
        {CLIS.map(({ cli }) => {
          const b = badgeDe(it, cli);
          return (
            <div key={cli} role="gridcell" className="cat-celula cat-cli">
              <span role="img" className="cat-badge" data-tom={b.tom} aria-label={`${rotuloCli(cli)}: ${b.texto}`} title={`${rotuloCli(cli)}: ${b.texto}`}>{b.simbolo}</span>
            </div>
          );
        })}
      </div>,
    );
  }

  return (
    <div className="cat-grade" role="grid" aria-label={rotulo} aria-rowcount={total + 1} aria-colcount={2 + CLIS.length}>
      <div role="row" aria-rowindex={1} className="cat-linha cat-cabecalho">
        <div role="columnheader" className="cat-celula cat-nome">Nome</div>
        <div role="columnheader" className="cat-celula cat-origem">Origem</div>
        {CLIS.map((c) => <div key={c.cli} role="columnheader" className="cat-celula cat-cli" title={c.rotulo}><abbr title={c.rotulo}>{c.sigla}</abbr></div>)}
      </div>
      <div ref={ref} className="cat-rolagem" onScroll={aoRolar} data-total={total} tabIndex={focoValido >= primeiro && focoValido < ultimo ? undefined : 0}>
        <div role="rowgroup" style={{ height: total * ALTURA_LINHA, position: "relative" }}>{visiveis}</div>
      </div>
    </div>
  );
}
