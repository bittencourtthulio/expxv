import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icone } from "../../../componentes/Icone";
import { avisar } from "../../../estado/avisos";
import { csvDeTabela } from "../logica";
import type { BlocoPlano } from "../painel-logica";
import type { DestinoAcao, GraficoDef, SvgDef } from "./definicoes";
import { NoReact } from "./React";

/** baixa o CSV da série localmente (sem caminho, sem IPC: a tabela já está no renderer). */
function baixarCsv(g: GraficoDef): void {
  try {
    const blob = new Blob([`﻿${csvDeTabela(g.tabela.colunas, g.tabela.linhas)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${g.id}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { avisar("Não foi possível gerar o CSV.", "erro"); }
}

/** Mede o elemento (largura e altura reais, em passos de 4 px para não redesenhar a cada pixel). Sem `ResizeObserver` (testes) devolve `null`. */
export function useMedida<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number } | null] {
  const ref = useRef<T>(null);
  const [m, setM] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const ler = (): void => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width / 4) * 4; const h = Math.round(r.height / 4) * 4;
      setM((a) => (a !== null && a.w === w && a.h === h ? a : { w, h }));
    };
    ler();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(ler);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, m];
}

/** Uma figura SVG: o gráfico é redesenhado na medida real da área (texto sempre no tamanho do app, nunca encolhido por escala). */
function Figura({ s }: { s: SvgDef }) {
  const [ref, m] = useMedida<HTMLDivElement>();
  const no = useMemo(() => (m === null || m.w < 96 || m.h < 64 ? s.no : s.desenhar({ largura: m.w, altura: m.h })), [s, m]);
  return (
    <figure className="ag-figura">
      {s.titulo !== null && <figcaption>{s.titulo}</figcaption>}
      <div ref={ref} className="ag-fig-area"><NoReact no={no} /></div>
    </figure>
  );
}

const FORMA_SAUDE = { verde: "Em dia", amarelo: "Atenção", vermelho: "Alerta" } as const;
function FormaSaude({ cor }: { cor: "verde" | "amarelo" | "vermelho" }) {
  return (
    <svg className="ag-forma" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      {cor === "verde" ? <circle cx="8" cy="8" r="5.5" className="st-verde" /> : cor === "amarelo" ? <path d="M8 2 14.5 13.5H1.5Z" className="st-amarelo" /> : <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" className="st-vermelho" />}
    </svg>
  );
}

export interface PropsCartao {
  g: GraficoDef;
  expandido: boolean;
  aoExpandir: () => void;
  /** posição na malha (papel, colunas, linhas); sem ela o cartão ocupa o espaço que o contêiner der. */
  plano?: BlocoPlano;
  aoAcionar?: (d: DestinoAcao) => void;
}

/**
 * Bloco de um gráfico: título, unidade, "n = …", uma frase de leitura, o SVG (redesenhado na medida do bloco), tabela equivalente em <details>, expandir e CSV.
 * O tooltip usa DELEGAÇÃO: um único `onMouseOver/Move` no corpo lê `data-tip` do alvo e mexe só no DOM do balão (nenhum re-render ao passar o mouse).
 */
export function CartaoGrafico({ g, expandido, aoExpandir, plano, aoAcionar }: PropsCartao) {
  const idTitulo = useId();
  const balao = useRef<HTMLDivElement>(null);
  const [tabelaAberta, setTabelaAberta] = useState(false);
  const mostrar = (e: React.MouseEvent<HTMLDivElement>): void => {
    const alvo = (e.target as Element).closest?.("[data-tip]");
    const b = balao.current;
    if (b === null) return;
    if (alvo === null || alvo === undefined) { b.hidden = true; return; }
    const caixa = e.currentTarget.getBoundingClientRect();
    b.textContent = alvo.getAttribute("data-tip") ?? "";
    b.hidden = false;
    const larg = b.offsetWidth || 160;
    b.style.left = `${Math.max(0, Math.min(caixa.width - larg - 4, e.clientX - caixa.left + 12))}px`;
    b.style.top = `${Math.max(0, e.clientY - caixa.top - 34)}px`;
  };
  const esconder = (): void => { if (balao.current !== null) balao.current.hidden = true; };
  const estilo = plano === undefined ? undefined : ({ "--sp": plano.span, "--ln": plano.linhas } as CSSProperties);
  return (
    <section className="ag-bloco" data-papel={plano?.papel ?? "bloco"} data-expandido={expandido || undefined} data-vazio={g.vazio !== null || undefined} style={estilo} aria-labelledby={idTitulo} data-grafico={g.id}>
      <header className="ag-bloco-cab">
        <h3 id={idTitulo}>{g.titulo}</h3>
        {(g.unidade !== "" || g.n !== null) && <span className="ag-meta">{[g.unidade, g.n !== null ? `n = ${g.n} ${g.nRotulo}` : ""].filter((x) => x !== "").join(" · ")}</span>}
        <span className="ag-acoes">
          <button type="button" className="ag-icone-btn" onClick={aoExpandir} aria-pressed={expandido} aria-label={`${expandido ? "Recolher" : "Expandir"} ${g.titulo}`} title={expandido ? "Recolher" : "Expandir"}><Icone nome="expandir" /></button>
          <button type="button" className="ag-icone-btn" onClick={() => baixarCsv(g)} disabled={g.tabela.linhas.length === 0} aria-label={`Exportar CSV de ${g.titulo}`} title="Exportar CSV"><Icone nome="baixar" /></button>
        </span>
      </header>
      {g.vazio !== null ? (
        <div className="ag-vazio-grafico" role="status">
          <p>{g.vazio}</p>
          {g.acaoVazio != null && aoAcionar !== undefined && <button type="button" className="ag-btn" onClick={() => aoAcionar((g.acaoVazio as NonNullable<GraficoDef["acaoVazio"]>).destino)}>{g.acaoVazio.rotulo}</button>}
        </div>
      ) : (
        <>
          {g.leitura != null && g.leitura !== "" && <p className="ag-leitura">{g.leitura}</p>}
          {g.saude !== undefined ? (
            <ul className="ag-saude-lista" aria-label="Indicadores de saúde da sprint">
              {g.saude.map((s) => (
                <li key={s.id} data-cor={s.cor}>
                  <FormaSaude cor={s.cor} />
                  <span className="ag-saude-texto"><span className="ag-saude-estado">{FORMA_SAUDE[s.cor]}</span> {s.frase}<span className="ag-meta ag-saude-fato">{s.fato}</span></span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ag-corpo-grafico" onMouseOver={mostrar} onMouseMove={mostrar} onMouseLeave={esconder}>
              {g.svgs.map((s, i) => <Figura key={i} s={s} />)}
              <div ref={balao} className="ag-balao" role="presentation" hidden />
            </div>
          )}
          <details className="ag-tabela" onToggle={(e) => setTabelaAberta((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>Tabela de dados</summary>
            {tabelaAberta && (
              <div className="ag-tabela-rolagem">
                <table>
                  <caption className="so-leitor">{g.titulo}: dados equivalentes ao gráfico</caption>
                  <thead><tr>{g.tabela.colunas.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
                  <tbody>{g.tabela.linhas.slice(0, 400).map((l, i) => <tr key={i}>{l.map((c, j) => <td key={j}>{c === null ? "—" : c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
          </details>
        </>
      )}
    </section>
  );
}
