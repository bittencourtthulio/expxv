import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiMapa, DadosAnaliseMapa } from "../../../compartilhado/mapa";
import { VirtualLista } from "../../componentes/VirtualLista";
import { BotaoCopiar, Carregando, FaixaErro } from "./comum";
import { celulasDeViolacao, dsmParaTela } from "./layout-camadas";

const CELULA = 22;
const CABECALHO = 120;

interface Props { api: ApiMapa; ws: string; versao: number }

/** Matriz de dependência entre módulos (DSM), em canvas com rolagem virtual: só as células da janela são desenhadas. */
export function VisaoCamadas({ api, ws, versao }: Props) {
  const [dados, setDados] = useState<DadosAnaliseMapa["camadas"] | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [tentativa, setTentativa] = useState(0);
  const [celula, setCelula] = useState<{ i: number; j: number } | null>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [vista, setVista] = useState({ x: 0, y: 0, w: 640, h: 360 });

  useEffect(() => {
    let vivo = true;
    setDados(null);
    setErro(null);
    void api.analise(ws, "camadas").then((r) => { if (vivo) setDados(r.dados); }, (e: unknown) => { if (vivo) setErro(e); });
    return () => { vivo = false; };
  }, [api, ws, versao, tentativa]);

  const dsm = useMemo(() => (dados === null ? null : dsmParaTela(dados.dsm)), [dados]);
  const violacoes = useMemo(() => (dados === null || dsm === null ? new Set<string>() : celulasDeViolacao(dados.violacoes, dsm.agregado)), [dados, dsm]);
  const ciclosMod = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of dados?.ciclos ?? []) for (const mod of c.modulos) m.set(dsm?.agregado === true ? (mod.split("/")[0] ?? mod) : mod, c.id);
    return m;
  }, [dados, dsm]);

  useEffect(() => {
    const el = rolagem.current;
    if (el === null) return;
    const ler = (): void => setVista({ x: el.scrollLeft, y: el.scrollTop, w: el.clientWidth || 640, h: el.clientHeight || 360 });
    ler();
    el.addEventListener("scroll", ler, { passive: true });
    let obs: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") { obs = new ResizeObserver(ler); obs.observe(el); }
    return () => { el.removeEventListener("scroll", ler); obs?.disconnect(); };
  }, [dsm === null]);

  useEffect(() => {
    const c = canvas.current;
    if (c === null || dsm === null) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = c.getContext("2d"); } catch { ctx = null; }
    if (ctx === null) return;
    const cs = getComputedStyle(c);
    const v = (n: string, p: string): string => cs.getPropertyValue(n).trim() || p;
    const texto = v("--texto", "black"), borda = v("--borda", "gray"), destaque = v("--destaque", "blue"), alerta = v("--alerta", "red"), aviso = v("--aviso", "orange"), suave = v("--texto-discreto", "gray"), sobre = v("--sobre-destaque", "white");
    c.width = vista.w; c.height = vista.h;
    ctx.clearRect(0, 0, vista.w, vista.h);
    const n = dsm.modulos.length;
    const i0 = Math.max(0, Math.floor(vista.y / CELULA)), i1 = Math.min(n, Math.ceil((vista.y + vista.h - CABECALHO) / CELULA) + 1);
    const j0 = Math.max(0, Math.floor(vista.x / CELULA)), j1 = Math.min(n, Math.ceil((vista.x + vista.w - CABECALHO) / CELULA) + 1);
    ctx.font = `10px ${cs.fontFamily || "sans-serif"}`;
    ctx.textBaseline = "middle";
    for (let i = i0; i < i1; i++) {
      const y = CABECALHO + i * CELULA - vista.y;
      ctx.fillStyle = ciclosMod.has(dsm.modulos[i] as string) ? aviso : texto;
      ctx.fillText((dsm.modulos[i] as string).slice(-18), 2, y + CELULA / 2);
      for (let j = j0; j < j1; j++) {
        const x = CABECALHO + j * CELULA - vista.x;
        const cont = dsm.celulas[i]?.[j] ?? 0;
        const marca = violacoes.has(`${dsm.modulos[i]}>${dsm.modulos[j]}`);
        ctx.strokeStyle = borda;
        ctx.strokeRect(x + 0.5, y + 0.5, CELULA - 1, CELULA - 1);
        if (marca) { ctx.fillStyle = alerta; ctx.globalAlpha = 0.85; ctx.fillRect(x + 1, y + 1, CELULA - 2, CELULA - 2); ctx.globalAlpha = 1; }
        else if (cont > 0) { ctx.fillStyle = destaque; ctx.globalAlpha = Math.min(0.25 + Math.log2(cont + 1) / 6, 0.9); ctx.fillRect(x + 1, y + 1, CELULA - 2, CELULA - 2); ctx.globalAlpha = 1; }
        if (cont > 0 && i !== j) { ctx.fillStyle = marca ? sobre : suave; ctx.fillText(String(cont), x + 3, y + CELULA / 2); }
        if (celula !== null && celula.i === i && celula.j === j) { ctx.strokeStyle = texto; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, CELULA - 2, CELULA - 2); ctx.lineWidth = 1; }
      }
    }
  }, [dsm, vista, violacoes, ciclosMod, celula]);

  if (erro !== null) return <FaixaErro erro={erro} aoTentar={() => setTentativa((t) => t + 1)} />;
  if (dados === null || dsm === null) return <Carregando texto="Calculando camadas…" />;
  if (dsm.modulos.length === 0) return <p className="mp-vazio">Sem módulos para a matriz. Analise o projeto primeiro.</p>;

  const linhas = dados.violacoes.map((v, k) => ({ ...v, k }));
  const sel = celula === null ? null : { de: dsm.modulos[celula.i] as string, para: dsm.modulos[celula.j] as string, n: dsm.celulas[celula.i]?.[celula.j] ?? 0 };
  const evidencias = sel === null ? [] : dados.violacoes.filter((v) => {
    const k = (m: string): string => (dsm.agregado ? (m.split("/")[0] ?? m) : m);
    return k(v.de_modulo) === sel.de && k(v.para_modulo) === sel.para;
  }).flatMap((v) => v.evidencias);

  return (
    <div className="mp-camadas">
      <div className="mp-grafo-info" role="status">
        <span>{dsm.modulos.length} módulos{dsm.agregado ? " (agregados pela pasta de 1º nível)" : ""} · {dados.violacoes.length} violações candidatas · {dados.ciclos.length} ciclos entre módulos</span>
        <span className="mp-legenda"><i className="mp-leg-viol" aria-hidden="true" /> violação <i className="mp-leg-dep" aria-hidden="true" /> dependência (linha depende da coluna)</span>
      </div>
      <div className="mp-dsm-rolagem" ref={rolagem}>
        <div style={{ width: CABECALHO + dsm.modulos.length * CELULA, height: CABECALHO + dsm.modulos.length * CELULA, position: "relative" }}>
          <canvas
            ref={canvas}
            className="mp-dsm-canvas"
            style={{ position: "sticky", top: 0, left: 0 }}
            role="img"
            aria-label={`Matriz de dependências entre ${dsm.modulos.length} módulos; a lista abaixo traz as violações com evidências.`}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const j = Math.floor((e.clientX - r.left + vista.x - CABECALHO) / CELULA);
              const i = Math.floor((e.clientY - r.top + vista.y - CABECALHO) / CELULA);
              setCelula(i >= 0 && j >= 0 && i < dsm.modulos.length && j < dsm.modulos.length ? { i, j } : null);
            }}
          />
        </div>
      </div>
      {sel !== null && (
        <div className="mp-celula" role="status">
          <strong>{sel.de} depende de {sel.para}</strong> ({sel.n} importações)
          {evidencias.length === 0 ? <span className="mp-meta"> — sem violação registrada para este par</span> : (
            <ul>{evidencias.map((ev) => <li key={ev}><code>{ev}</code> <BotaoCopiar texto={ev} rotulo={`Copiar evidência ${ev}`} /></li>)}</ul>
          )}
        </div>
      )}
      <div className="mp-lista-viol">
        {linhas.length === 0 ? <p className="mp-vazio">Nenhuma violação candidata encontrada.</p> : (
          <VirtualLista
            itens={linhas}
            alturaItem={36}
            rotulo="Violações de camada"
            chave={(l) => String(l.k)}
            renderItem={(l) => (
              <div className="mp-item mp-item-dupla">
                <span>{l.de_modulo} → {l.para_modulo} <span className="mp-selo" data-tom={l.origem === "regra" ? "alerta" : "aviso"}>{l.origem}</span></span>
                <span className="mp-meta">{l.motivo}{l.evidencias[0] !== undefined ? ` · ${l.evidencias[0]}` : ""}</span>
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}
