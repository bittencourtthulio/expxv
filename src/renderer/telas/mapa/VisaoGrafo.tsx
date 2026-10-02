import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoGrafo } from "../../../compartilhado/conhecimento";
import type { ApiMapa, GrafoMapaIpc } from "../../../compartilhado/mapa";
import { VirtualLista } from "../../componentes/VirtualLista";
import { Grafo3DSobDemanda } from "../../componentes/grafo3d/Grafo3DSobDemanda";
import { escolherModo, gravarSimples, lerSimples, preferirMenosMovimento, webgl2Disponivel } from "../../componentes/grafo3d/suporte";
import { CAMERA_PADRAO, deslocar, enquadrar, raioDoNo, telaParaMundo, mundoParaTela, zoomEm, type Camera } from "../conhecimento/grafo-vista";
import { criarSimulacao, fatia, rodarAte, type Simulacao } from "../conhecimento/grafo-layout";
import { agrupar, alternarExpansao, chaveGrupo, modoEfetivo, type GrafoAgrupado, type ModoAgrupar } from "./agrupamento";
import { Carregando, FaixaErro } from "./comum";
import { filtrarLocal, paraFiltroIpc, type EstadoFiltros } from "./filtros";
import { OPCOES_COLORIR, PALETA_MAPA, paraGrafo3D, type ColorirPor } from "./dados3d";
import { acharNaGrade, criarGrade, type Grade } from "./grade";
import { escolherArestas, escolherRotulos, mostrarRotulos, nosVisiveis, retanguloVisivel } from "./lod";
import { formatarNumero } from "./logica";
import { proximoNaDirecao, semearPorPasta } from "./semente";

export interface PropsVisaoGrafo {
  api: ApiMapa;
  ws: string;
  versao: number;
  filtros: EstadoFiltros;
  modo: ModoAgrupar;
  selecionado: string | null;
  aoSelecionar: (id: string | null) => void;
  /** Teste: dispensa o canvas (jsdom não tem 2D). */
  semCanvas?: boolean;
}

interface Cores { texto: string; suave: string; borda: string; destaque: string; alerta: string; superficie: string; painel: string }

function lerCores(el: Element): Cores {
  const cs = getComputedStyle(el);
  const v = (n: string, padrao: string): string => cs.getPropertyValue(n).trim() || padrao;
  return { texto: v("--texto", "currentColor"), suave: v("--texto-discreto", "gray"), borda: v("--borda-campo", "gray"), destaque: v("--destaque", "blue"), alerta: v("--alerta", "red"), superficie: v("--superficie", "white"), painel: v("--painel", "white") };
}

function hashCurto(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `g${(h >>> 0).toString(16)}`;
}

const reduzirMovimento = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const adaptarNo = (n: GrafoAgrupado["nos"][number], p: { x: number; y: number }): NoGrafo => ({ id: n.id, tipo: n.cluster ? "cluster" : "arquivo", rotulo: n.rotulo, peso: n.cluster ? Math.sqrt(n.w) : Math.min(n.w, 400) / 10, x: p.x, y: p.y, ultimo_em: "", mission_id: null } as unknown as NoGrafo);

export function VisaoGrafo({ api, ws, versao, filtros, modo, selecionado, aoSelecionar, semCanvas = false }: PropsVisaoGrafo) {
  const [grafo, setGrafo] = useState<GrafoMapaIpc | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [tentativa, setTentativa] = useState(0);
  const [expandidos, setExpandidos] = useState<ReadonlySet<string>>(new Set());
  const [lista, setLista] = useState(false);
  const [selIdx, setSelIdx] = useState(-1);
  const [simples, setSimples] = useState(lerSimples);
  const [colorirPor, setColorirPor] = useState<ColorirPor>("linguagem");
  const [dimensoes, setDimensoes] = useState({ w: 800, h: 480 });
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Camera>({ ...CAMERA_PADRAO });
  const sim = useRef<Simulacao | null>(null);
  const grade = useRef<Grade | null>(null);
  const quadro = useRef(0);
  const sujo = useRef(true);
  const estavel = useRef(false);
  const arrasto = useRef<{ x: number; y: number; moveu: number } | null>(null);
  const filtroChave = JSON.stringify(paraFiltroIpc(filtros));

  useEffect(() => {
    let vivo = true;
    setGrafo(null);
    setErro(null);
    void api.grafo(ws, "arquivo", paraFiltroIpc(filtros), 20000).then((g) => { if (vivo) setGrafo(g); }, (e: unknown) => { if (vivo) setErro(e); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, ws, versao, filtroChave, tentativa]);

  const filtrado = useMemo(() => (grafo === null ? null : filtrarLocal(grafo, filtros)), [grafo, filtros]);
  const agrupado = useMemo<GrafoAgrupado | null>(() => (filtrado === null ? null : agrupar(filtrado, modo, expandidos)), [filtrado, modo, expandidos]);
  const podeTres = !semCanvas && webgl2Disponivel() && !preferirMenosMovimento();
  const usa3d = escolherModo({ webgl2: !semCanvas && webgl2Disponivel(), reduzirMovimento: preferirMenosMovimento(), simples }) === "3d";
  const dados3d = useMemo(() => (usa3d && agrupado !== null ? paraGrafo3D(agrupado, colorirPor) : null), [usa3d, agrupado, colorirPor]);
  const alternarSimples = useCallback((v: boolean) => { gravarSimples(v); setSimples(v); }, []);
  const modoReal = filtrado === null ? modo : modoEfetivo(modo, filtrado.nos.length);

  const arrays = useMemo(() => {
    if (agrupado === null) return null;
    const de = Int32Array.from(agrupado.arestas, (a) => a[0]);
    const para = Int32Array.from(agrupado.arestas, (a) => a[1]);
    const idx = new Map(agrupado.nos.map((n, i) => [n.id, i]));
    const pesos = Float64Array.from(agrupado.nos, (n) => n.w);
    const adj: number[][] = agrupado.nos.map(() => []);
    agrupado.arestas.forEach((a) => { (adj[a[0]] as number[]).push(a[1]); (adj[a[1]] as number[]).push(a[0]); });
    return { de, para, idx, pesos, adj };
  }, [agrupado]);

  // dimensões e movimento reduzido
  useEffect(() => {
    const el = area.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => { if (el.clientWidth > 0 && el.clientHeight > 0) { setDimensoes({ w: el.clientWidth, h: el.clientHeight }); sujo.current = true; } });
    obs.observe(el);
    return () => obs.disconnect();
  }, [lista, agrupado === null]);

  const desenhar = useCallback(() => {
    const c = canvas.current;
    const s = sim.current;
    const g = agrupado;
    const a = arrays;
    if (c === null || s === null || g === null || a === null) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = c.getContext("2d"); } catch { ctx = null; }
    if (ctx === null) return;
    const { w, h } = dimensoes;
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cores = lerCores(c);
    ctx.clearRect(0, 0, w, h);
    const k = cam.current;
    const ret = retanguloVisivel(k.cx, k.cy, k.zoom, w, h);
    const vis = nosVisiveis(s.x, s.y, ret, 30 / k.zoom);
    const visSet = new Set(vis);
    const sel = new Set<number>();
    if (selIdx >= 0) { sel.add(selIdx); for (const v of a.adj[selIdx] ?? []) sel.add(v); }
    const esc = escolherArestas(a.de, a.para, visSet, sel);
    ctx.lineWidth = 1;
    for (const passo of ["normal", "heuristica", "ciclo", "selecao"] as const) {
      ctx.beginPath();
      for (const e of esc.indices) {
        const de = a.de[e] as number, pa = a.para[e] as number;
        const aresta = g.arestas[e] as GrafoAgrupado["arestas"][number];
        const noDe = g.nos[de] as GrafoAgrupado["nos"][number], noPa = g.nos[pa] as GrafoAgrupado["nos"][number];
        const naSel = sel.has(de) && sel.has(pa) && (de === selIdx || pa === selIdx);
        const tipo = naSel ? "selecao" : noDe.ciclo && noPa.ciclo ? "ciclo" : aresta[3] === 0 ? "heuristica" : "normal";
        if (tipo !== passo) continue;
        const [x0, y0] = mundoParaTela(k, w, h, s.x[de] as number, s.y[de] as number);
        const [x1, y1] = mundoParaTela(k, w, h, s.x[pa] as number, s.y[pa] as number);
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.strokeStyle = passo === "selecao" ? cores.destaque : passo === "ciclo" ? cores.alerta : cores.borda;
      ctx.globalAlpha = passo === "normal" || passo === "heuristica" ? 0.45 : 0.9;
      ctx.setLineDash(passo === "heuristica" ? [4, 3] : []);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    for (const i of vis) {
      const n = g.nos[i] as GrafoAgrupado["nos"][number];
      const [sx, sy] = mundoParaTela(k, w, h, s.x[i] as number, s.y[i] as number);
      const r = raioDoNo(n.cluster ? Math.sqrt(n.w) : n.w / 10) * Math.max(k.zoom, 0.4) * (n.cluster ? 1.4 : 1);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = i === selIdx ? cores.destaque : n.ciclo ? cores.alerta : n.cluster ? cores.superficie : cores.painel;
      ctx.fill();
      ctx.lineWidth = i === selIdx || n.cluster ? 2 : 1;
      ctx.strokeStyle = i === selIdx ? cores.destaque : n.ciclo ? cores.alerta : cores.borda;
      ctx.stroke();
    }
    const rotulos = escolherRotulos(g.nos.map((n) => n.id), a.pesos, vis, sel, k.zoom);
    ctx.font = `11px ${getComputedStyle(c).fontFamily || "sans-serif"}`;
    ctx.fillStyle = cores.texto;
    ctx.textBaseline = "middle";
    for (const i of rotulos) {
      const n = g.nos[i] as GrafoAgrupado["nos"][number];
      const [sx, sy] = mundoParaTela(k, w, h, s.x[i] as number, s.y[i] as number);
      ctx.fillText(n.cluster ? `${n.rotulo} (${n.membros})` : n.rotulo, sx + 9, sy);
    }
  }, [agrupado, arrays, dimensoes, selIdx]);

  // simulação semeada pela árvore de pastas; posições cacheadas via IPC
  useEffect(() => {
    if (agrupado === null || arrays === null || usa3d) return;
    let vivo = true;
    const semente = semearPorPasta(agrupado.nos.map((n) => ({ id: n.id, g: n.grupo })));
    const nos = agrupado.nos.map((n) => adaptarNo(n, semente.get(n.id) ?? { x: 0, y: 0 }));
    const arestas = agrupado.arestas.map((a) => ({ origem: (agrupado.nos[a[0]] as GrafoAgrupado["nos"][number]).id, destino: (agrupado.nos[a[1]] as GrafoAgrupado["nos"][number]).id, tipo: a[2], peso: a[4] }));
    const chave = hashCurto(`${modoReal}|${agrupado.nos.length}|${agrupado.arestas.length}|${filtroChave}|${agrupado.nos.slice(0, 20).map((n) => n.id).join(",")}`);
    const s = criarSimulacao(nos, arestas, { semente: chave });
    sim.current = s;
    grade.current = null;
    estavel.current = false;
    const concluir = (): void => {
      estavel.current = true;
      const c = enquadrar(s.x, s.y, dimensoes.w, dimensoes.h, 30);
      cam.current = c;
      sujo.current = true;
      grade.current = null;
    };
    const salvar = (): void => {
      if (!vivo || s.n === 0 || s.n > 20000) return;
      const flat: number[] = [];
      for (let i = 0; i < s.n; i++) flat.push(Math.round((s.x[i] as number) * 10) / 10, Math.round((s.y[i] as number) * 10) / 10);
      void api.layoutGravar(ws, chave, "arquivo", flat).catch(() => undefined);
    };
    void api.layoutLer(ws, chave).then((cache) => {
      if (!vivo) return;
      if (cache !== null && cache.posicoes.length === s.n * 2) {
        for (let i = 0; i < s.n; i++) { s.x[i] = cache.posicoes[2 * i] as number; s.y[i] = cache.posicoes[2 * i + 1] as number; }
        concluir();
        return;
      }
      if (reduzirMovimento() || semCanvas) { rodarAte(s, { maxPassos: 120 }); concluir(); salvar(); return; }
      const passo = (): void => {
        if (!vivo) return;
        const r = fatia(s, 8);
        sujo.current = true;
        if (r.estavel) { concluir(); salvar(); return; }
        quadro.current = requestAnimationFrame(passo);
      };
      quadro.current = requestAnimationFrame(passo);
    }, () => undefined);
    return () => { vivo = false; cancelAnimationFrame(quadro.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agrupado, arrays, api, ws, modoReal, filtroChave, semCanvas, usa3d]);

  // laço de desenho (só redesenha quando algo mudou)
  useEffect(() => {
    if (semCanvas || usa3d) return;
    let vivo = true;
    let q = 0;
    const laco = (): void => {
      if (!vivo) return;
      if (sujo.current) { sujo.current = false; desenhar(); }
      q = requestAnimationFrame(laco);
    };
    sujo.current = true;
    q = requestAnimationFrame(laco);
    return () => { vivo = false; cancelAnimationFrame(q); };
  }, [desenhar, semCanvas, usa3d]);

  // seleção externa (busca, painel): garante que o nó esteja visível (expande o grupo) e centraliza
  useEffect(() => {
    if (selecionado === null || agrupado === null || arrays === null || filtrado === null) { setSelIdx(-1); return; }
    const i = arrays.idx.get(selecionado);
    if (i !== undefined) {
      setSelIdx(i);
      const s = sim.current;
      if (s !== null && estavel.current) { cam.current = { ...cam.current, cx: s.x[i] as number, cy: s.y[i] as number }; }
      sujo.current = true;
      return;
    }
    const original = filtrado.nos.find((n) => n.id === selecionado);
    if (original !== undefined) setExpandidos((e) => new Set(e).add(chaveGrupo(original, modoEfetivo(modo, filtrado.nos.length))));
  }, [selecionado, agrupado, arrays, filtrado, modo]);

  useEffect(() => { sujo.current = true; }, [selIdx]);

  // roda do mouse (precisa de listener não passivo)
  useEffect(() => {
    const c = canvas.current;
    if (c === null) return;
    const roda = (e: WheelEvent): void => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      cam.current = zoomEm(cam.current, dimensoes.w, dimensoes.h, e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      sujo.current = true;
    };
    c.addEventListener("wheel", roda, { passive: false });
    return () => c.removeEventListener("wheel", roda);
  }, [dimensoes, agrupado === null, lista]);

  const escolher = useCallback((i: number, expandir = false) => {
    if (agrupado === null) return;
    const n = agrupado.nos[i];
    if (n === undefined) return;
    setSelIdx(i);
    if (n.cluster) {
      if (expandir) setExpandidos((e) => alternarExpansao(e, n.grupo));
      aoSelecionar(null);
    } else aoSelecionar(n.id);
  }, [agrupado, aoSelecionar]);

  const noPonto = (cx: number, cy: number): number => {
    const s = sim.current;
    const c = canvas.current;
    if (s === null || c === null) return -1;
    if (grade.current === null) grade.current = criarGrade(s.x, s.y, Float64Array.from({ length: s.n }, () => 8), 48);
    const r = c.getBoundingClientRect();
    const [wx, wy] = telaParaMundo(cam.current, dimensoes.w, dimensoes.h, cx - r.left, cy - r.top);
    return acharNaGrade(grade.current, wx, wy, 6 / cam.current.zoom);
  };

  const aoTeclar = (e: React.KeyboardEvent): void => {
    const s = sim.current;
    if (s === null || arrays === null) return;
    const dir: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dir[e.key];
    if (d !== undefined) {
      e.preventDefault();
      const base = selIdx >= 0 ? selIdx : 0;
      if (selIdx < 0) { escolher(base); return; }
      const alvo = proximoNaDirecao(s.x, s.y, selIdx, arrays.adj[selIdx] ?? [], d[0], d[1]);
      if (alvo >= 0) escolher(alvo);
    } else if (e.key === "Enter" && selIdx >= 0) { e.preventDefault(); escolher(selIdx, true); }
    else if (e.key === "Escape") { setSelIdx(-1); aoSelecionar(null); }
    else if (e.key === "+" || e.key === "=") { cam.current = zoomEm(cam.current, dimensoes.w, dimensoes.h, dimensoes.w / 2, dimensoes.h / 2, 1.2); sujo.current = true; }
    else if (e.key === "-") { cam.current = zoomEm(cam.current, dimensoes.w, dimensoes.h, dimensoes.w / 2, dimensoes.h / 2, 1 / 1.2); sujo.current = true; }
    else if (e.key === "0") { cam.current = enquadrar(s.x, s.y, dimensoes.w, dimensoes.h, 30); sujo.current = true; }
  };

  if (erro !== null) return <FaixaErro erro={erro} aoTentar={() => setTentativa((t) => t + 1)} />;
  if (grafo === null || agrupado === null) return <Carregando texto="Carregando o grafo…" />;
  if (agrupado.nos.length === 0) return <p className="mp-vazio">Nenhum nó para os filtros atuais. Limpe os filtros ou analise de novo.</p>;

  const ordenados = [...agrupado.nos.keys()].sort((a, b) => (agrupado.nos[b]?.w ?? 0) - (agrupado.nos[a]?.w ?? 0));
  return (
    <div className="mp-grafo">
      <div className="mp-grafo-info" role="status">
        <span>{formatarNumero(agrupado.nos.length)} nós · {formatarNumero(agrupado.arestas.length)} arestas{agrupado.agrupado ? " (agrupados; Enter ou duplo clique expande)" : ""}</span>
        {grafo.truncado && <span className="mp-aviso-inline">mostrando {formatarNumero(grafo.nos.length)} de {formatarNumero(grafo.total_nos)} nós; use filtros</span>}
        {!usa3d && !mostrarRotulos(cam.current.zoom) && <span>aproxime para ver os rótulos</span>}
        <span className="mp-legenda"><i className="mp-leg-tracejado" aria-hidden="true" /> heurística <i className="mp-leg-ciclo" aria-hidden="true" /> ciclo</span>
        <span className="mp-espaco" />
        {podeTres && simples && !lista && <button type="button" className="mp-btn" onClick={() => alternarSimples(false)}>Modo 3D</button>}
        <button type="button" className="mp-btn" aria-pressed={lista} onClick={() => setLista((l) => !l)}>Ver como lista</button>
        {!usa3d && <button type="button" className="mp-btn" onClick={() => { const s = sim.current; if (s !== null) { cam.current = enquadrar(s.x, s.y, dimensoes.w, dimensoes.h, 30); sujo.current = true; } }}>Enquadrar</button>}
      </div>
      {lista ? (
        <VirtualLista
          itens={ordenados}
          alturaItem={24}
          rotulo="Nós do grafo"
          chave={(i) => agrupado.nos[i]?.id ?? String(i)}
          renderItem={(i) => {
            const n = agrupado.nos[i] as GrafoAgrupado["nos"][number];
            return <button type="button" className="mp-item" aria-current={i === selIdx ? "true" : undefined} onClick={() => escolher(i, true)}><span>{n.cluster ? `${n.rotulo} (${n.membros})` : n.rotulo}</span><span className="mp-meta">{n.grupo}</span></button>;
          }}
        />
      ) : usa3d && dados3d !== null ? (
        <Grafo3DSobDemanda
          nos={dados3d.nos}
          elos={dados3d.elos}
          paleta={PALETA_MAPA}
          legenda={dados3d.legenda}
          selecionadoId={selIdx >= 0 ? (agrupado.nos[selIdx]?.id ?? null) : null}
          aoSelecionar={(id) => { const i = id === null ? -1 : arrays?.idx.get(id) ?? -1; if (i >= 0) escolher(i); else { setSelIdx(-1); aoSelecionar(null); } }}
          aoAtivar={(id) => { const i = arrays?.idx.get(id) ?? -1; if (i >= 0) escolher(i, true); }}
          aoSimples={() => alternarSimples(true)}
          rotuloAcessivel="Grafo 3D do código"
          extras={<select aria-label="Colorir por" value={colorirPor} onChange={(e) => setColorirPor(e.target.value as ColorirPor)}>{OPCOES_COLORIR.map((o) => <option key={o.id} value={o.id}>Cor: {o.rotulo}</option>)}</select>}
        />
      ) : (
        <div className="mp-canvas-area" ref={area}>
          <canvas
            ref={canvas}
            className="mp-canvas"
            tabIndex={0}
            role="application"
            aria-label="Grafo do código. Setas navegam entre vizinhos, Enter expande o grupo, Esc limpa a seleção, + e - aproximam, 0 enquadra."
            width={dimensoes.w}
            height={dimensoes.h}
            onKeyDown={aoTeclar}
            onPointerDown={(e) => { arrasto.current = { x: e.clientX, y: e.clientY, moveu: 0 }; (e.target as Element).setPointerCapture?.(e.pointerId); }}
            onPointerMove={(e) => {
              const a = arrasto.current;
              if (a === null) return;
              const dx = e.clientX - a.x, dy = e.clientY - a.y;
              a.moveu += Math.abs(dx) + Math.abs(dy);
              a.x = e.clientX; a.y = e.clientY;
              if (a.moveu > 4) { cam.current = deslocar(cam.current, dx, dy); sujo.current = true; }
            }}
            onPointerUp={(e) => { const a = arrasto.current; arrasto.current = null; if (a !== null && a.moveu <= 4) { const i = noPonto(e.clientX, e.clientY); if (i >= 0) escolher(i); else { setSelIdx(-1); aoSelecionar(null); } } }}
            onDoubleClick={(e) => { const i = noPonto(e.clientX, e.clientY); if (i >= 0) escolher(i, true); }}
          />
        </div>
      )}
    </div>
  );
}
