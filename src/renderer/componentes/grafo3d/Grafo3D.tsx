// Casca React do grafo 3D (chunk carregado sob demanda): monta o WebGL2, liga seleção/filtro/tema e oferece controles, legenda e teclado.
// A lista textual equivalente fica nas telas (aba Lista do Conhecimento; "Ver como lista" do Mapa).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { atribuirTokens } from "./cores";
import { montarGrafo3D, type Elo3D, type GrafoMontado, type No3D } from "./index";
import { preferirMenosMovimento } from "./suporte";
import "./grafo3d.css";

export interface ItemLegenda { categoria: string; rotulo: string; n: number }
export interface PropsGrafo3D {
  nos: readonly No3D[];
  elos: readonly Elo3D[];
  paleta?: Readonly<Record<string, string>>;
  legenda: readonly ItemLegenda[];
  selecionadoId: string | null;
  filtro?: ((n: No3D) => boolean) | null;
  aoSelecionar: (id: string | null) => void;
  aoAtivar?: (id: string) => void;
  /** volta ao modo simples (botão ou falha do WebGL). */
  aoSimples: () => void;
  rotuloAcessivel: string;
  aviso?: ReactNode;
  extras?: ReactNode;
}

export default function Grafo3D({ nos, elos, paleta, legenda, selecionadoId, filtro = null, aoSelecionar, aoAtivar, aoSimples, rotuloAcessivel, aviso, extras }: PropsGrafo3D) {
  const palco = useRef<HTMLDivElement>(null);
  const grafo = useRef<GrafoMontado | null>(null);
  const cb = useRef({ aoSelecionar, aoAtivar, aoSimples, selecionadoId, filtro });
  cb.current = { aoSelecionar, aoAtivar, aoSimples, selecionadoId, filtro };
  const [dica, setDica] = useState<{ rotulo: string; x: number; y: number } | null>(null);
  const rotulos = useMemo(() => new Map(nos.map((n) => [n.id, n.rotulo])), [nos]);
  const tokens = useMemo(() => atribuirTokens(legenda.map((l) => l.categoria), paleta ?? {}), [legenda, paleta]);
  const anuncio = selecionadoId === null ? "" : `Selecionado: ${rotulos.get(selecionadoId) ?? selecionadoId}`;

  useEffect(() => {
    const el = palco.current;
    if (el === null) return;
    let g: GrafoMontado;
    try {
      g = montarGrafo3D(el, {
        nos, elos, ...(paleta !== undefined ? { paleta } : {}), reduzirMovimento: preferirMenosMovimento(),
        aoSelecionar: (id) => cb.current.aoSelecionar(id), aoAtivar: (id) => cb.current.aoAtivar?.(id), aoFalhar: () => cb.current.aoSimples(),
        aoPassar: (i) => setDica(i === null ? null : { rotulo: rotulos.get(i.id) ?? i.id, x: i.x, y: i.y }),
      });
    } catch { cb.current.aoSimples(); return; }
    grafo.current = g;
    g.filtra(cb.current.filtro);
    if (cb.current.selecionadoId !== null) g.seleciona(cb.current.selecionadoId, true);
    const tema = new MutationObserver(() => g.atualizaTema());
    tema.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    return () => { tema.disconnect(); g.desmontar(); grafo.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nos, elos, paleta]);

  useEffect(() => { grafo.current?.filtra(filtro); }, [filtro]);
  useEffect(() => { grafo.current?.seleciona(selecionadoId, true); }, [selecionadoId]);

  const aoTeclar = (e: KeyboardEvent<HTMLElement>): void => {
    const g = grafo.current;
    if (g === null) return;
    switch (e.key) {
      case "ArrowLeft": g.orbita(-0.12, 0); break;
      case "ArrowRight": g.orbita(0.12, 0); break;
      case "ArrowDown": g.proximo(1); break;
      case "ArrowUp": g.proximo(-1); break;
      case "+": case "=": g.zoom(0.8); break;
      case "-": case "_": g.zoom(1.25); break;
      case "0": g.enquadra(); cb.current.aoSelecionar(null); break;
      case "Escape": g.seleciona(null, true); cb.current.aoSelecionar(null); break;
      case "Enter": if (cb.current.selecionadoId !== null) cb.current.aoAtivar?.(cb.current.selecionadoId); break;
      default: return;
    }
    e.preventDefault();
  };
  const foto = (): void => {
    const url = grafo.current?.foto();
    if (url === undefined) return;
    try { const a = document.createElement("a"); a.href = url; a.download = "grafo.png"; a.click(); } catch { /* sem download */ }
  };

  return (
    <div className="g3d" data-nos={nos.length} data-modo="3d">
      <div ref={palco} className="g3d-palco" tabIndex={0} role="application" aria-label={`${rotuloAcessivel}. Setas esquerda e direita giram, setas acima e abaixo percorrem os nós, mais e menos aproximam, zero enquadra, Esc limpa. A lista textual é a versão navegável.`} onKeyDown={aoTeclar} />
      <div className="g3d-ctl" role="group" aria-label="Controles do grafo 3D">
        {extras}
        <button type="button" onClick={() => grafo.current?.reorganiza()} title="Reorganizar a rede">Reorganizar</button>
        <button type="button" onClick={() => { grafo.current?.enquadra(); aoSelecionar(null); }} title="Enquadrar tudo (0)">Enquadrar</button>
        <button type="button" onClick={foto} title="Baixar uma foto (PNG)">Foto</button>
        <button type="button" onClick={aoSimples} title="Voltar ao desenho simples (2D)">Modo simples</button>
      </div>
      {dica !== null ? <div className="g3d-dica" style={{ left: dica.x, top: dica.y }} aria-hidden="true">{dica.rotulo}</div> : null}
      {aviso !== undefined && aviso !== null ? <p className="g3d-aviso" role="status">{aviso}</p> : null}
      <ul className="g3d-legenda" aria-label="Legenda das categorias">
        {legenda.map((l) => <li key={l.categoria}><span className="g3d-ponto" style={{ background: `var(${tokens.get(l.categoria) ?? "--texto-suave"})`, color: `var(${tokens.get(l.categoria) ?? "--texto-suave"})` }} aria-hidden="true" />{l.rotulo} {l.n}</li>)}
      </ul>
      <p className="g3d-sr" role="status" aria-live="polite">{anuncio}</p>
    </div>
  );
}
