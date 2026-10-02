// Grafo de conhecimento em canvas 2D próprio (sem biblioteca). Layout de forças em fatias de ≤ 8 ms por quadro (grafo-layout.ts),
// posições salvas abrem sem simular; `prefers-reduced-motion` calcula as posições finais direto. O canvas é decorativo para leitores
// de tela (aria-hidden): o equivalente acessível é a aba Lista.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Elo3D, No3D } from "../../componentes/grafo3d/Grafo3DSobDemanda";
import type { ArestaGrafo, NoGrafo } from "../../../compartilhado/conhecimento";
import type { PosicaoNo } from "../../../compartilhado/conhecimento-api";
import { Icone } from "../../componentes/Icone";
import { Grafo3DSobDemanda } from "../../componentes/grafo3d/Grafo3DSobDemanda";
import { escolherModo, gravarSimples, lerSimples, preferirMenosMovimento as menosMovimento, webgl2Disponivel } from "../../componentes/grafo3d/suporte";
import { criarSimulacao, fatia, posicoesDe, rodarAte, type Simulacao } from "./grafo-layout";
import { MAX_ROTULOS, acharNo, deslocar, enquadrar, mundoParaTela, raioDoNo, selecionarRotulos, zoomEm, type Camera, CAMERA_PADRAO } from "./grafo-vista";
import { agruparPorTipo, corDaAresta, corDoTipo, rotuloDoTipo, vizinhosDe } from "./logica";

export const ORCAMENTO_FATIA_MS = 8;

export interface PropsGrafo {
  nos: readonly NoGrafo[];
  arestas: readonly ArestaGrafo[];
  selecionadoId: string | null;
  semente: string;
  truncado: boolean;
  aoSelecionar: (id: string | null) => void;
  aoFocar: (id: string) => void;
  aoPosicoes: (p: PosicaoNo[]) => void;
  /** força a política de movimento (teste); padrão: media query. */
  reduzirMovimento?: boolean;
  atrasoPosicoesMs?: number;
}

function preferirMenosMovimento(): boolean {
  try { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}
/** Resolve `var(--token)` para a cor do tema atual (o canvas não entende var()); cache por quadro. */
const lerVar = (nome: string, padrao: string): string => {
  try { const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim(); return v === "" ? padrao : v; } catch { return padrao; }
};
function criarResolvedor(): (cor: string) => string {
  const cache = new Map<string, string>();
  return (cor) => {
    const m = /^var\((--[\w-]+)\)$/.exec(cor);
    if (m === null) return cor;
    const nome = m[1] as string;
    let v = cache.get(nome);
    if (v === undefined) { v = lerVar(nome, "gray"); cache.set(nome, v); }
    return v;
  };
}

function Grafo2D({ nos, arestas, selecionadoId, semente, truncado, aoSelecionar, aoFocar, aoPosicoes, reduzirMovimento, atrasoPosicoesMs = 1200, aoTres }: PropsGrafo & { aoTres?: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef<Simulacao | null>(null);
  const indice = useRef(new Map<string, number>());
  const raios = useRef(new Float64Array(0));
  const camera = useRef<Camera>({ ...CAMERA_PADRAO });
  const tamanho = useRef({ w: 800, h: 600 });
  const hover = useRef(-1);
  const estavel = useRef(true);
  const sujo = useRef(true);
  const raf = useRef(0);
  const timerPos = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrasto = useRef<{ x: number; y: number; mexeu: boolean } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const props = useRef({ nos, arestas, selecionadoId, aoSelecionar, aoFocar, aoPosicoes });
  props.current = { nos, arestas, selecionadoId, aoSelecionar, aoFocar, aoPosicoes };
  const legenda = useMemo(() => agruparPorTipo(nos), [nos]);

  const desenhar = useCallback(() => {
    const cv = canvas.current;
    const s = sim.current;
    if (cv === null || s === null) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = cv.getContext("2d"); } catch { ctx = null; }
    if (ctx === null || ctx === undefined) return;
    const { w, h } = tamanho.current;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cam = camera.current;
    const { nos: lista, arestas: ligacoes, selecionadoId: sel } = props.current;
    const cor = criarResolvedor();
    const destaque = cor("var(--destaque)");
    const texto = cor("var(--texto)");
    const fundo = cor("var(--fundo)");
    const idxSel = sel !== null ? (indice.current.get(sel) ?? -1) : -1;
    const vizinhos = new Set<string>(sel !== null ? vizinhosDe(sel, ligacoes) : []);
    ctx.lineWidth = 1;
    for (const a of ligacoes) {
      const i = indice.current.get(a.origem);
      const j = indice.current.get(a.destino);
      if (i === undefined || j === undefined) continue;
      const [x1, y1] = mundoParaTela(cam, w, h, s.x[i] as number, s.y[i] as number);
      const [x2, y2] = mundoParaTela(cam, w, h, s.x[j] as number, s.y[j] as number);
      if ((x1 < 0 && x2 < 0) || (y1 < 0 && y2 < 0) || (x1 > w && x2 > w) || (y1 > h && y2 > h)) continue;
      const ligada = sel !== null && (a.origem === sel || a.destino === sel);
      ctx.globalAlpha = ligada ? 0.95 : sel !== null ? 0.18 : 0.5;
      ctx.strokeStyle = ligada ? destaque : cor(corDaAresta(a.tipo));
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const pontos: Array<{ id: string; x: number; y: number; peso: number }> = [];
    for (let i = 0; i < lista.length; i++) {
      const no = lista[i] as NoGrafo;
      const [sx, sy] = mundoParaTela(cam, w, h, s.x[i] as number, s.y[i] as number);
      pontos.push({ id: no.id, x: s.x[i] as number, y: s.y[i] as number, peso: no.peso });
      if (sx < -12 || sy < -12 || sx > w + 12 || sy > h + 12) continue;
      const r = Math.max(2.5, (raios.current[i] as number) * Math.min(cam.zoom, 2.2));
      ctx.globalAlpha = sel !== null && i !== idxSel && !vizinhos.has(no.id) ? 0.35 : 1;
      ctx.fillStyle = cor(corDoTipo(no.tipo));
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      if (i === idxSel || i === hover.current) { ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.strokeStyle = i === idxSel ? destaque : texto; ctx.beginPath(); ctx.arc(sx, sy, r + 3, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
    }
    ctx.globalAlpha = 1;
    const forcados = new Set<string>(sel !== null ? [sel, ...vizinhos] : []);
    if (hover.current >= 0) forcados.add((lista[hover.current] as NoGrafo).id);
    const ids = selecionarRotulos(pontos, cam, w, h, MAX_ROTULOS, forcados);
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const id of ids) {
      const i = indice.current.get(id);
      if (i === undefined) continue;
      const [sx, sy] = mundoParaTela(cam, w, h, s.x[i] as number, s.y[i] as number);
      const rotulo = (lista[i] as NoGrafo).rotulo;
      const txt = rotulo.length > 28 ? `${rotulo.slice(0, 27)}…` : rotulo;
      const r = Math.max(2.5, (raios.current[i] as number) * Math.min(cam.zoom, 2.2));
      ctx.lineWidth = 3; ctx.strokeStyle = fundo; ctx.strokeText(txt, sx + r + 4, sy);
      ctx.fillStyle = texto; ctx.fillText(txt, sx + r + 4, sy);
    }
  }, []);

  const agendar = useCallback(() => {
    sujo.current = true;
    if (raf.current !== 0) return;
    const quadro = (): void => {
      raf.current = 0;
      const s = sim.current;
      if (s !== null && !estavel.current) {
        const r = fatia(s, ORCAMENTO_FATIA_MS);
        if (r.estavel) {
          estavel.current = true;
          if (timerPos.current !== null) clearTimeout(timerPos.current);
          timerPos.current = setTimeout(() => { if (sim.current !== null) props.current.aoPosicoes(posicoesDe(sim.current)); }, atrasoPosicoesMs);
        }
        sujo.current = true;
      }
      if (sujo.current) { sujo.current = false; desenhar(); }
      if (!estavel.current) raf.current = requestAnimationFrame(quadro);
    };
    raf.current = requestAnimationFrame(quadro);
  }, [desenhar, atrasoPosicoesMs]);

  // tamanho do canvas segue o contêiner
  useEffect(() => {
    const cv = canvas.current;
    if (cv === null) return;
    const medir = (): void => {
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (w > 0 && h > 0) tamanho.current = { w, h };
      agendar();
    };
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(cv);
    return () => obs.disconnect();
  }, [agendar]);

  // (re)constrói a simulação quando os nós mudam
  useEffect(() => {
    indice.current = new Map(nos.map((n, i) => [n.id, i]));
    raios.current = Float64Array.from(nos.map((n) => raioDoNo(n.peso)));
    const s = criarSimulacao(nos, arestas, { semente });
    sim.current = s;
    const todosPosicionados = nos.length > 0 && nos.every((n) => n.x !== null && n.y !== null);
    const menos = reduzirMovimento ?? preferirMenosMovimento();
    if (todosPosicionados) estavel.current = true;
    else if (menos) { rodarAte(s, { maxPassos: nos.length > 500 ? 150 : 400 }); estavel.current = true; aoPosicoes(posicoesDe(s)); }
    else { estavel.current = nos.length === 0; s.alfa = 1; }
    camera.current = enquadrar(s.x, s.y, tamanho.current.w, tamanho.current.h, 48);
    hover.current = -1;
    agendar();
    return () => { if (timerPos.current !== null) { clearTimeout(timerPos.current); timerPos.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nos, arestas, semente, agendar, reduzirMovimento]);

  useEffect(() => { agendar(); }, [selecionadoId, agendar]);
  useEffect(() => () => { if (raf.current !== 0) cancelAnimationFrame(raf.current); raf.current = 0; }, []);

  // zoom na roda (listener não passivo, para impedir a rolagem da página)
  useEffect(() => {
    const cv = canvas.current;
    if (cv === null) return;
    const aoRoda = (e: WheelEvent): void => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      camera.current = zoomEm(camera.current, tamanho.current.w, tamanho.current.h, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
      agendar();
    };
    cv.addEventListener("wheel", aoRoda, { passive: false });
    return () => cv.removeEventListener("wheel", aoRoda);
  }, [agendar]);

  const posicaoLocal = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.current?.getBoundingClientRect();
    return [e.clientX - (r?.left ?? 0), e.clientY - (r?.top ?? 0)];
  };
  const noEm = (px: number, py: number): number => {
    const s = sim.current;
    return s === null ? -1 : acharNo(s.x, s.y, raios.current, camera.current, tamanho.current.w, tamanho.current.h, px, py);
  };

  const aoPressionar = (e: React.PointerEvent): void => {
    arrasto.current = { x: e.clientX, y: e.clientY, mexeu: false };
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* jsdom */ }
  };
  const aoMover = (e: React.PointerEvent): void => {
    const a = arrasto.current;
    if (a !== null) {
      const dx = e.clientX - a.x;
      const dy = e.clientY - a.y;
      if (!a.mexeu && Math.hypot(dx, dy) < 4) return;
      if (!a.mexeu) { a.mexeu = true; setArrastando(true); }
      camera.current = deslocar(camera.current, dx, dy);
      a.x = e.clientX; a.y = e.clientY;
      agendar();
      return;
    }
    const [px, py] = posicaoLocal(e);
    const i = noEm(px, py);
    if (i !== hover.current) { hover.current = i; agendar(); }
  };
  const aoSoltar = (e: React.PointerEvent): void => {
    const a = arrasto.current;
    arrasto.current = null;
    setArrastando(false);
    if (a === null || a.mexeu) return;
    const [px, py] = posicaoLocal(e);
    const i = noEm(px, py);
    props.current.aoSelecionar(i >= 0 ? (props.current.nos[i] as NoGrafo).id : null);
  };
  const aoDuploClique = (e: React.MouseEvent): void => {
    const [px, py] = posicaoLocal(e);
    const i = noEm(px, py);
    if (i >= 0) props.current.aoFocar((props.current.nos[i] as NoGrafo).id);
  };

  const zoomCentro = (f: number): void => { camera.current = zoomEm(camera.current, tamanho.current.w, tamanho.current.h, tamanho.current.w / 2, tamanho.current.h / 2, f); agendar(); };
  const reenquadrar = (): void => { const s = sim.current; if (s !== null) { camera.current = enquadrar(s.x, s.y, tamanho.current.w, tamanho.current.h, 48); agendar(); } };
  const aoTeclar = (e: KeyboardEvent<HTMLElement>): void => {
    const passo = 40;
    switch (e.key) {
      case "+": case "=": zoomCentro(1.25); break;
      case "-": case "_": zoomCentro(0.8); break;
      case "0": reenquadrar(); break;
      case "ArrowLeft": camera.current = deslocar(camera.current, passo, 0); agendar(); break;
      case "ArrowRight": camera.current = deslocar(camera.current, -passo, 0); agendar(); break;
      case "ArrowUp": camera.current = deslocar(camera.current, 0, passo); agendar(); break;
      case "ArrowDown": camera.current = deslocar(camera.current, 0, -passo); agendar(); break;
      case "Escape": props.current.aoSelecionar(null); break;
      default: return;
    }
    e.preventDefault();
  };

  return (
    <div className="con-grafo" role="group" aria-label="Grafo de conhecimento. Use as teclas mais, menos, zero e setas; a aba Lista é a versão navegável por nós." tabIndex={0} onKeyDown={aoTeclar}>
      <canvas ref={canvas} aria-hidden="true" data-nos={nos.length} data-arrastando={arrastando ? "true" : "false"} onPointerDown={aoPressionar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerLeave={() => { if (hover.current !== -1) { hover.current = -1; agendar(); } }} onDoubleClick={aoDuploClique} />
      <div className="con-grafo-ctl" role="group" aria-label="Zoom do grafo">
        <button type="button" className="con-icone-btn" aria-label="Aproximar" title="Aproximar (+)" onClick={() => zoomCentro(1.25)}><Icone nome="mais" /></button>
        <button type="button" className="con-icone-btn" aria-label="Afastar" title="Afastar (-)" onClick={() => zoomCentro(0.8)}><Icone nome="menos" /></button>
        {aoTres !== undefined ? <button type="button" className="con-icone-btn" aria-label="Modo 3D" title="Voltar ao grafo 3D" onClick={aoTres}>3D</button> : null}
        <button type="button" className="con-icone-btn" aria-label="Enquadrar tudo" title="Enquadrar tudo (0)" onClick={reenquadrar}><Icone nome="expandir" /></button>
      </div>
      {truncado ? <p className="con-aviso-truncado" role="status">Grafo truncado: mostrando os nós mais relevantes. Use os filtros ou dê duplo clique num nó para focar.</p> : null}
      <ul className="con-legenda" aria-label="Legenda dos tipos de nó">
        {legenda.map((g) => <li key={g.tipo}><span className="con-ponto" style={{ background: corDoTipo(g.tipo) }} aria-hidden="true" />{rotuloDoTipo(g.tipo)} {g.n}</li>)}
      </ul>
    </div>
  );
}

/** Grafo de conhecimento: 3D (WebGL2, chunk sob demanda) quando possível; canvas 2D com "reduzir movimento", sem WebGL2 ou no modo simples. */
export function Grafo(props: PropsGrafo) {
  const [simples, setSimples] = useState(lerSimples);
  const reduzir = props.reduzirMovimento ?? menosMovimento();
  const webgl2 = webgl2Disponivel();
  const usa3d = escolherModo({ webgl2, reduzirMovimento: reduzir, simples }) === "3d";
  const alternar = useCallback((v: boolean) => { gravarSimples(v); setSimples(v); }, []);
  const { nos, arestas } = props;
  const dados = useMemo(() => (usa3d ? { n: nos.map((n): No3D => ({ id: n.id, rotulo: n.rotulo, categoria: n.tipo, peso: Math.log1p(Math.max(n.peso, 0)) })), e: arestas.map((a): Elo3D => ({ a: a.origem, b: a.destino, peso: a.peso })) } : null), [usa3d, nos, arestas]);
  const paleta = useMemo(() => Object.fromEntries(nos.map((n) => [n.tipo, corDoTipo(n.tipo)])), [nos]);
  const legenda = useMemo(() => agruparPorTipo(nos).map((g) => ({ categoria: g.tipo, rotulo: rotuloDoTipo(g.tipo), n: g.n })), [nos]);
  if (!usa3d || dados === null) return <Grafo2D {...props} {...(webgl2 && !reduzir ? { aoTres: () => alternar(false) } : {})} />;
  return (
    <Grafo3DSobDemanda
      nos={dados.n}
      elos={dados.e}
      paleta={paleta}
      legenda={legenda}
      selecionadoId={props.selecionadoId}
      aoSelecionar={props.aoSelecionar}
      aoAtivar={props.aoFocar}
      aoSimples={() => alternar(true)}
      rotuloAcessivel="Grafo de conhecimento em 3D"
      aviso={props.truncado ? "Grafo truncado: mostrando os nós mais relevantes. Use os filtros ou dê duplo clique num nó para focar." : null}
    />
  );
}
