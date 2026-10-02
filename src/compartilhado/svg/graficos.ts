// Construtores de gráfico (puros): devolvem `NoSvg`. Cor e traço vêm de classes (`ln-N`, `fl-N`, `st-*`); distinção SEM cor: tracejado por série (linhas) e
// padrão por série (barras/áreas, `<pattern>`). Toda marca interativa leva `data-tip` (tooltip por delegação de evento: hover sem re-render).
// Orçamento: ≤ 600 elementos por série (decimação) e ≤ 1 500 por gráfico (testado).
import { decimar, amostrarIndices } from "./decimar";
import { escalaLinear, formatarNumero, indicesDeRotulo, ticksY } from "./escala";
import { no, r2, type NoSvg } from "./no";

export const LARGURA = 640;
export const ALTURA = 240;
export const MAX_PONTOS_SERIE = 600;
const TRACOS = ["", "6 3", "2 3", "8 3 2 3", "1 3", "10 4"] as const;
const NSERIES = 6;
const cl = (k: number): number => (k % NSERIES) + 1;

/** `largura`/`altura` (px reais do contêiner) ligam o modo FLUIDO: viewBox = tamanho real, texto 1:1, margens enxutas, sem unidade no eixo. Sem eles, saída legada (640×240). */
export interface MoldeSvg { id: string; titulo: string; desc: string; largura?: number | undefined; altura?: number | undefined }

/** Medidas de um gráfico (puro). `legenda`: reserva a faixa do topo; `direto`: reserva a margem direita para rótulos nas séries. */
export interface Dim { W: number; H: number; l: number; r: number; t: number; b: number; cw: number; fluido: boolean; ticksY: number; rotX: number }
export function dimDe(m: Pick<MoldeSvg, "largura" | "altura">, o: { legenda?: number | boolean; direto?: number } = {}): Dim {
  if (m.largura === undefined) return { W: LARGURA, H: ALTURA, l: 44, r: 12, t: 12, b: 28, cw: 5.4, fluido: false, ticksY: 5, rotX: 8 };
  const W = Math.max(160, Math.round(m.largura));
  const H = Math.max(96, Math.round(m.altura ?? W * 0.42));
  const l = 34; const r = 10 + (o.direto ?? 0); const b = 22;
  const linhasLeg = o.legenda === true ? 1 : o.legenda === false || o.legenda === undefined ? 0 : o.legenda;
  const t = linhasLeg > 0 ? 8 + linhasLeg * 17 : 8;
  return { W, H, l, r, t, b, cw: 6.4, fluido: true, ticksY: Math.max(2, Math.min(6, Math.floor((H - t - b) / 44))), rotX: Math.max(2, Math.floor((W - l - r) / 62)) };
}
const larguraTexto = (d: Dim, s: string): number => Math.ceil(s.length * d.cw);
const CHAVE = 15; const FOLGA_LEG = 14;
/** posiciona a legenda do modo fluido quebrando em linhas dentro de `largura`; devolve as posições e o número de linhas (puro). */
export function quebrarLegenda(largura: number, nomes: readonly string[], cw = 6.4, margem = 34): { pos: Array<{ x: number; linha: number }>; linhas: number } {
  const limite = Math.max(120, largura) - 10;
  const pos: Array<{ x: number; linha: number }> = [];
  let x = margem; let linha = 0;
  for (const nome of nomes) {
    const larg = CHAVE + Math.ceil(nome.length * cw);
    if (x > margem && x + larg > limite) { linha++; x = margem; }
    pos.push({ x, linha });
    x += larg + FOLGA_LEG;
  }
  return { pos, linhas: nomes.length === 0 ? 0 : linha + 1 };
}
const linhasLegenda = (m: Pick<MoldeSvg, "largura">, nomes: readonly string[]): number => (m.largura === undefined ? 0 : quebrarLegenda(Math.max(160, Math.round(m.largura)), nomes).linhas);

/** distribui rótulos verticais sem sobreposição (puro): mantém a ordem por `y`, empurra para baixo e, se estourar, volta para cima. */
export function espalharRotulos(ys: readonly number[], gap: number, min: number, max: number): number[] {
  const ordem = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const pos = ordem.map((o) => Math.min(max, Math.max(min, o.y)));
  for (let k = 1; k < pos.length; k++) if ((pos[k] as number) - (pos[k - 1] as number) < gap) pos[k] = (pos[k - 1] as number) + gap;
  for (let k = pos.length - 1; k >= 0; k--) {
    if ((pos[k] as number) > max) pos[k] = max;
    if (k < pos.length - 1 && (pos[k + 1] as number) - (pos[k] as number) < gap) pos[k] = (pos[k + 1] as number) - gap;
  }
  const out = new Array<number>(ys.length).fill(0);
  ordem.forEach((o, k) => { out[o.i] = pos[k] as number; });
  return out;
}

function moldura(m: MoldeSvg, filhos: Array<NoSvg | null | false>, d: Dim, altura = d.H): NoSvg {
  const padroes: NoSvg[] = [];
  for (let k = 1; k <= NSERIES; k++) {
    const p = no("pattern", { id: `${m.id}-p${k}`, width: 6, height: 6, patternUnits: "userSpaceOnUse" }, no("rect", { class: `fl-${k} fundo-padrao`, width: 6, height: 6 }));
    const tracos: Array<NoSvg | null> = [
      null, no("path", { class: `ln-${k}`, d: "M0 6L6 0", "stroke-width": 1.2 }), no("circle", { class: `fl-${k} ponto-padrao`, cx: 3, cy: 3, r: 1 }),
      no("path", { class: `ln-${k}`, d: "M0 3H6", "stroke-width": 1.2 }), no("path", { class: `ln-${k}`, d: "M3 0V6", "stroke-width": 1.2 }), no("path", { class: `ln-${k}`, d: "M0 0L6 6", "stroke-width": 1.2 }),
    ];
    const t = tracos[k - 1];
    padroes.push(t ? { ...p, c: [...(p.c ?? []), t] } : p);
  }
  return no("svg", { viewBox: `0 0 ${d.W} ${altura}`, class: "svg-g", role: "img", "aria-labelledby": `${m.id}-t ${m.id}-d`, preserveAspectRatio: "xMidYMid meet", focusable: "false" },
    no("title", { id: `${m.id}-t` }, m.titulo), no("desc", { id: `${m.id}-d` }, m.desc), no("defs", undefined, ...padroes), ...filhos);
}

function eixoY(ticks: number[], esc: (v: number) => number, unidade: string, d: Dim): NoSvg[] {
  const out: NoSvg[] = [];
  for (const t of ticks) {
    out.push(no("line", { class: "grade", x1: d.l, x2: d.W - d.r, y1: r2(esc(t)), y2: r2(esc(t)) }));
    out.push(no("text", { class: "rot", x: d.l - 6, y: r2(esc(t) + 3), "text-anchor": "end" }, formatarNumero(t)));
  }
  if (unidade && !d.fluido) out.push(no("text", { class: "rot unidade", x: 2, y: 9 }, unidade));
  return out;
}
function eixoXRotulos(rotulos: readonly string[], xi: (i: number) => number, d: Dim): NoSvg[] {
  return indicesDeRotulo(rotulos.length, d.rotX).map((i) => no("text", { class: "rot", x: r2(xi(i)), y: d.fluido ? d.H - 6 : d.H - 8, "text-anchor": i === 0 ? "start" : i === rotulos.length - 1 ? "end" : "middle" }, rotulos[i] ?? ""));
}
const dadosTip = (s: string): { "data-tip": string } => ({ "data-tip": s });

/** legenda (cor + padrão) numa linha no topo direito. */
function legenda(id: string, nomes: readonly string[], d: Dim): NoSvg {
  const itens: NoSvg[] = [];
  if (d.fluido) {
    // modo fluido: legenda à esquerda, sob a borda superior, com quadrado do tamanho do texto
    const { pos } = quebrarLegenda(d.W, nomes, d.cw, d.l);
    nomes.forEach((nome, k) => {
      const p = pos[k] as { x: number; linha: number };
      const y0 = 3 + p.linha * 17;
      itens.push(no("g", { class: "leg" }, no("rect", { x: r2(p.x), y: y0, width: 10, height: 10, rx: 2, fill: `url(#${id}-p${cl(k)})`, class: `ln-${cl(k)} chave`, "stroke-width": 1 }), no("text", { class: "rot", x: r2(p.x + CHAVE), y: y0 + 9 }, nome)));
    });
    return no("g", { class: "legenda" }, ...itens);
  }
  let x = d.W - d.r;
  for (let k = nomes.length - 1; k >= 0; k--) {
    const nome = nomes[k] ?? "";
    const larg = 14 + nome.length * d.cw;
    x -= larg;
    itens.push(no("g", { class: "leg" }, no("rect", { x: r2(x), y: 2, width: 9, height: 9, fill: `url(#${id}-p${cl(k)})`, class: `ln-${cl(k)}`, "stroke-width": 1 }), no("text", { class: "rot", x: r2(x + 12), y: 10 }, nome)));
  }
  return no("g", { class: "legenda" }, ...itens);
}

// --------------------------------------------------------------------------------------------- linhas / degraus / áreas
export interface SerieLinha { rotulo: string; valores: ReadonlyArray<number | null>; modo?: "linha" | "degrau" | "area" }
/** `rotuloDireto` (só no modo fluido): o nome da série fica no fim da linha (ou na faixa da área) em vez de uma legenda separada. */
export interface OpcLinhas extends MoldeSvg { rotulosX: readonly string[]; series: readonly SerieLinha[]; unidade: string; ref?: { valor: number; rotulo: string } | null; empilhado?: boolean; rotuloDireto?: boolean }

export function graficoLinhas(o: OpcLinhas): NoSvg {
  const n = o.rotulosX.length;
  const direto = o.rotuloDireto === true && o.largura !== undefined;
  const d0 = dimDe(o, { direto: direto ? Math.max(0, ...o.series.map((s) => s.rotulo.length)) * 6.4 + 8 : 0, legenda: direto ? 0 : o.largura === undefined ? true : linhasLegenda(o, o.series.map((s) => s.rotulo)) });
  const d = d0;
  const base = o.series.map((s) => s.valores.map((v) => v));
  const acum = o.empilhado ? base.map((_, k) => o.series[0]?.valores.map((_v, i) => base.slice(0, k + 1).reduce((a, s) => a + (s[i] ?? 0), 0)) ?? []) : null;
  const todos = (acum ?? base).flat().filter((v): v is number => v !== null);
  const topo = Math.max(0, ...todos, o.ref?.valor ?? 0);
  const { ticks, min, max } = ticksY(Math.min(0, ...todos), topo, d.ticksY);
  const ey = escalaLinear(min, max, d.H - d.b, d.t);
  const xi = (i: number): number => (n <= 1 ? (d.l + d.W - d.r) / 2 : d.l + (i * (d.W - d.l - d.r)) / (n - 1));
  const marcas: NoSvg[] = [];
  const fins: Array<{ k: number; x: number; y: number; v: number }> = [];
  o.series.forEach((s, k) => {
    const vals = acum ? (acum[k] as number[]) : (s.valores as Array<number | null>);
    const pts = decimar(vals.map((v, i) => ({ i, v })), MAX_PONTOS_SERIE, (p) => p.v);
    let dd = ""; let aberto = false; let ult: { x: number; y: number } | null = null;
    const modo = s.modo ?? "linha";
    for (const p of pts) {
      if (p.v === null) { aberto = false; continue; }
      const x = r2(xi(p.i)); const y = r2(ey(p.v));
      if (!aberto) { dd += `M${x} ${y}`; aberto = true; } else dd += modo === "degrau" && ult ? `H${x}V${y}` : `L${x} ${y}`;
      ult = { x, y };
    }
    if (dd === "") return;
    if (ult) fins.push({ k, x: ult.x, y: ult.y, v: [...vals].reverse().find((v) => v !== null) as number });
    if (modo === "area") {
      const ini = pts.find((p) => p.v !== null);
      const fim = [...pts].reverse().find((p) => p.v !== null);
      if (ini && fim) marcas.push(no("path", { d: `${dd}L${r2(xi(fim.i))} ${r2(ey(0))}L${r2(xi(ini.i))} ${r2(ey(0))}Z`, fill: `url(#${o.id}-p${cl(k)})`, "fill-opacity": 0.55, class: `ln-${cl(k)} area`, "stroke-width": 1 }));
    } else marcas.push(no("path", { d: dd, class: `ln-${cl(k)} serie`, fill: "none", "stroke-width": d.fluido ? 2.25 : 2, "stroke-dasharray": TRACOS[k % NSERIES] || undefined, "stroke-linejoin": "round" }));
  });
  if (o.ref) marcas.push(no("line", { class: "ref", x1: d.l, x2: d.W - d.r, y1: r2(ey(o.ref.valor)), y2: r2(ey(o.ref.valor)), "stroke-dasharray": "3 3" }), no("text", { class: "rot rot-ref", x: d.W - d.r, y: r2(ey(o.ref.valor) - 3), "text-anchor": "end" }, o.ref.rotulo));
  if (direto) {
    // rótulo no fim de cada série + ponto no último valor; áreas empilhadas rotulam no meio da faixa
    const alvo = fins.map((f) => {
      if (o.empilhado && acum) { const abaixo = f.k === 0 ? 0 : (acum[f.k - 1] as number[])[o.rotulosX.length - 1] ?? 0; return ey((f.v + abaixo) / 2); }
      return f.y;
    });
    const ys = espalharRotulos(alvo, 14, d.t + 6, d.H - d.b - 2);
    fins.forEach((f, j) => {
      const s = o.series[f.k] as SerieLinha;
      if ((s.modo ?? "linha") !== "area") marcas.push(no("circle", { cx: f.x, cy: f.y, r: 3.5, class: `fl-${cl(f.k)} ponto-fim`, ...dadosTip(`${s.rotulo}: ${formatarNumero(f.v)}`) }));
      marcas.push(no("text", { class: `rot rot-serie ln-${cl(f.k)}-txt`, x: r2(Math.min(d.W - 2, f.x + 8)), y: r2((ys[j] as number) + 4), "text-anchor": "start" }, s.rotulo));
    });
  }
  const larg = n <= 1 ? d.W - d.l - d.r : (d.W - d.l - d.r) / (n - 1);
  const hits = amostrarIndices(n, 300).map((i) => no("rect", { class: "hit", x: r2(xi(i) - larg / 2), y: d.t, width: r2(Math.max(2, larg)), height: d.H - d.t - d.b, ...dadosTip(`${o.rotulosX[i] ?? i}: ${o.series.map((s) => `${s.rotulo} ${s.valores[i] === null || s.valores[i] === undefined ? "—" : formatarNumero(s.valores[i] as number)}`).join(" · ")}`) }));
  return moldura(o, [...eixoY(ticks, ey, o.unidade, d), ...eixoXRotulos(o.rotulosX, xi, d), ...marcas, direto ? null : legenda(o.id, o.series.map((s) => s.rotulo), d), ...hits], d);
}

// --------------------------------------------------------------------------------------------- barras (agrupadas/empilhadas)
export interface SerieBarra { rotulo: string; valores: ReadonlyArray<number | null> }
export interface OpcBarras extends MoldeSvg { categorias: readonly string[]; series: readonly SerieBarra[]; unidade: string; empilhado?: boolean; ref?: { valor: number; rotulo: string } | null }

export function graficoBarras(o: OpcBarras): NoSvg {
  const n = o.categorias.length;
  const d = dimDe(o, { legenda: o.largura === undefined ? o.series.length > 1 : o.series.length > 1 ? linhasLegenda(o, o.series.map((s) => s.rotulo)) : 0 });
  const somas = o.categorias.map((_, i) => o.series.reduce((a, s) => a + (s.valores[i] ?? 0), 0));
  const picos = o.empilhado ? somas : o.series.flatMap((s) => s.valores.map((v) => v ?? 0));
  const { ticks, min, max } = ticksY(0, Math.max(0, ...picos, o.ref?.valor ?? 0), d.ticksY);
  const ey = escalaLinear(min, max, d.H - d.b, d.t);
  const largCat = (d.W - d.l - d.r) / Math.max(1, n);
  const nS = o.empilhado ? 1 : Math.max(1, o.series.length);
  const larg = Math.max(1, Math.min(d.fluido ? 28 : 34, (largCat * (d.fluido ? 0.78 : 0.7)) / nS));
  const marcas: NoSvg[] = [];
  for (let i = 0; i < n; i++) {
    const cx = d.l + largCat * (i + 0.5);
    let acc = 0;
    o.series.forEach((s, k) => {
      const v = s.valores[i];
      if (v === null || v === undefined) return;
      const x = o.empilhado ? cx - larg / 2 : cx - (larg * nS) / 2 + k * larg;
      const y0 = o.empilhado ? acc : 0;
      const y1 = y0 + v;
      if (o.empilhado) acc = y1;
      marcas.push(no("rect", { x: r2(x), y: r2(ey(Math.max(y0, y1))), width: r2(larg), height: r2(Math.max(0, Math.abs(ey(y0) - ey(y1)))), fill: `url(#${o.id}-p${cl(k)})`, class: `ln-${cl(k)} barra`, "stroke-width": 1, ...dadosTip(`${o.categorias[i]}: ${s.rotulo} ${formatarNumero(v)}`) }));
    });
  }
  if (o.ref) marcas.push(no("line", { class: "ref", x1: d.l, x2: d.W - d.r, y1: r2(ey(o.ref.valor)), y2: r2(ey(o.ref.valor)), "stroke-dasharray": "3 3" }));
  if (o.ref && d.fluido) marcas.push(no("text", { class: "rot rot-ref", x: d.W - d.r, y: r2(ey(o.ref.valor) - 3), "text-anchor": "end" }, o.ref.rotulo));
  const xi = (i: number): number => d.l + largCat * (i + 0.5);
  return moldura(o, [...eixoY(ticks, ey, o.unidade, d), ...eixoXRotulos(o.categorias, xi, d), ...marcas, o.series.length > 1 || !d.fluido ? legenda(o.id, o.series.map((s) => s.rotulo), d) : null], d);
}

/** barras horizontais 100 % empilhadas (distribuição, planejado×entregue): uma linha por grupo. */
export interface GrupoBarraH { rotulo: string; partes: { rotulo: string; valor: number }[] }
export function graficoBarrasHorizontais(o: MoldeSvg & { grupos: readonly GrupoBarraH[]; unidade: string; normalizar?: boolean }): NoSvg {
  const nomesLeg = [...new Set(o.grupos.flatMap((g) => g.partes.map((p) => p.rotulo)))];
  const d = dimDe(o, { legenda: o.largura === undefined ? true : linhasLegenda(o, nomesLeg) });
  const linhas = o.grupos.length;
  const rotL = d.fluido ? Math.max(...o.grupos.map((g) => larguraTexto(d, g.rotulo)), 24) + 8 : 0;
  const topoL = d.fluido ? d.t : d.t + 16;
  const alturaLinha = d.fluido ? Math.min(40, (d.H - topoL - 6) / Math.max(1, linhas)) : Math.min(34, (d.H - d.t - d.b) / Math.max(1, linhas));
  const maxTotal = Math.max(1, ...o.grupos.map((g) => g.partes.reduce((a, p) => a + p.valor, 0)));
  const x0Esc = d.fluido ? d.l - 28 + rotL : d.l + 40;
  const ex = escalaLinear(0, o.normalizar ? 1 : maxTotal, x0Esc, d.W - d.r);
  const nomes = [...new Set(o.grupos.flatMap((g) => g.partes.map((p) => p.rotulo)))];
  const marcas: NoSvg[] = [];
  o.grupos.forEach((g, i) => {
    const y = topoL + i * alturaLinha + (d.fluido ? alturaLinha * 0.15 : 0);
    const total = g.partes.reduce((a, p) => a + p.valor, 0);
    marcas.push(no("text", { class: "rot", x: d.fluido ? x0Esc - 8 : d.l + 34, y: r2(y + alturaLinha * (d.fluido ? 0.5 : 0.45)), "text-anchor": "end" }, g.rotulo));
    let acc = 0;
    for (const p of g.partes) {
      if (p.valor <= 0) continue;
      const frac = o.normalizar ? (total === 0 ? 0 : p.valor / total) : p.valor;
      const x0 = ex(acc); const x1 = ex(acc + frac);
      acc += frac;
      const k = nomes.indexOf(p.rotulo);
      marcas.push(no("rect", { x: r2(x0), y: r2(y), width: r2(Math.max(1, x1 - x0)), height: r2(alturaLinha * (d.fluido ? 0.62 : 0.7)), fill: `url(#${o.id}-p${cl(k)})`, class: `ln-${cl(k)} barra`, "stroke-width": 1, ...dadosTip(`${g.rotulo}: ${p.rotulo} ${formatarNumero(p.valor)}${o.normalizar && total > 0 ? ` (${Math.round((p.valor / total) * 100)} %)` : ""}`) }));
    }
  });
  const altura = d.fluido ? d.H : Math.max(120, Math.min(ALTURA, d.t + 24 + linhas * alturaLinha + d.b));
  return moldura(o, [...marcas, legenda(o.id, nomes, d)], d, altura);
}

// --------------------------------------------------------------------------------------------- dispersão
export interface PontoDisp { x: number; y: number; tip: string; grupo?: number }
export interface OpcDispersao extends MoldeSvg { pontos: readonly PontoDisp[]; rotuloX: string; rotuloY: string; refsY?: { valor: number; rotulo: string }[]; refX?: number | null; refYMeio?: number | null }

export function graficoDispersao(o: OpcDispersao): NoSvg {
  const d = dimDe(o, { legenda: true });
  const idx = amostrarIndices(o.pontos.length, MAX_PONTOS_SERIE);
  const pts = idx.map((i) => o.pontos[i] as PontoDisp);
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  const tY = ticksY(0, Math.max(0, ...ys, ...(o.refsY ?? []).map((r) => r.valor)), d.ticksY);
  const tX = ticksY(0, Math.max(1, ...xs), Math.max(2, Math.min(6, Math.floor((d.W - d.l - d.r) / 70))));
  const ey = escalaLinear(tY.min, tY.max, d.H - d.b, d.t);
  const ex = escalaLinear(tX.min, tX.max, d.l, d.W - d.r);
  const marcas: NoSvg[] = [];
  for (const t of tX.ticks) marcas.push(no("text", { class: "rot", x: r2(ex(t)), y: d.fluido ? d.H - 6 : d.H - 14, "text-anchor": "middle" }, formatarNumero(t)));
  if (d.fluido) marcas.push(no("text", { class: "rot unidade", x: d.l, y: 12, "text-anchor": "start" }, `${o.rotuloY} por ${o.rotuloX}`));
  else marcas.push(no("text", { class: "rot unidade", x: d.W - d.r, y: d.H - 2, "text-anchor": "end" }, o.rotuloX));
  (o.refsY ?? []).forEach((r, k) => marcas.push(no("line", { class: "ref", x1: d.l, x2: d.W - d.r, y1: r2(ey(r.valor)), y2: r2(ey(r.valor)), "stroke-dasharray": TRACOS[(k + 1) % NSERIES] || "3 3" }), no("text", { class: "rot rot-ref", x: d.W - d.r, y: r2(ey(r.valor) - 3), "text-anchor": "end" }, r.rotulo)));
  if (o.refX !== null && o.refX !== undefined) marcas.push(no("line", { class: "ref", x1: r2(ex(o.refX)), x2: r2(ex(o.refX)), y1: d.t, y2: d.H - d.b, "stroke-dasharray": "3 3" }));
  if (o.refYMeio !== null && o.refYMeio !== undefined) marcas.push(no("line", { class: "ref", x1: d.l, x2: d.W - d.r, y1: r2(ey(o.refYMeio)), y2: r2(ey(o.refYMeio)), "stroke-dasharray": "3 3" }));
  for (const p of pts) {
    const k = cl(p.grupo ?? 0);
    marcas.push(no("circle", { cx: r2(ex(p.x)), cy: r2(ey(p.y)), r: d.fluido ? 3.6 : 3.2, class: `fl-${k} ln-${k} ponto`, "stroke-width": 1, ...dadosTip(p.tip) }));
  }
  return moldura(o, [...eixoY(tY.ticks, ey, o.rotuloY, d), ...marcas], d);
}

// --------------------------------------------------------------------------------------------- saúde (indicadores com texto)
export interface LinhaSaude { cor: "verde" | "amarelo" | "vermelho"; frase: string; fato: string }
export function graficoSaude(o: MoldeSvg & { linhas: readonly LinhaSaude[] }): NoSvg {
  const d = dimDe(o);
  const h = d.fluido ? 26 : 22;
  const maxCar = d.fluido ? Math.max(12, Math.floor((d.W - 44) / d.cw)) : 96;
  const forma = (cor: LinhaSaude["cor"], y: number): NoSvg =>
    cor === "verde" ? no("circle", { cx: 16, cy: y, r: 6, class: "st-verde" })
      : cor === "amarelo" ? no("path", { d: `M16 ${y - 7}L23 ${y + 6}H9Z`, class: "st-amarelo" })
        : no("rect", { x: 10, y: y - 6, width: 12, height: 12, class: "st-vermelho" });
  const marcas: NoSvg[] = [];
  o.linhas.forEach((l, i) => {
    const y = 18 + i * h;
    marcas.push(no("g", { ...dadosTip(`${l.frase} — ${l.fato}`), class: "linha-saude" }, forma(l.cor, y), no("text", { class: "rot txt", x: 32, y: y + 4 }, `${l.cor === "verde" ? "OK" : l.cor === "amarelo" ? "Atenção" : "Alerta"}: ${l.frase.slice(0, maxCar)}`)));
  });
  return moldura(o, marcas, d, d.fluido ? Math.max(d.H, 18 + o.linhas.length * h + 8) : Math.max(60, 18 + o.linhas.length * h + 8));
}

// --------------------------------------------------------------------------------------------- previsão (percentis)
export function graficoPrevisao(o: MoldeSvg & { p50: number; p85: number; p95: number; r50: string; r85: string; r95: string; unidade: string }): NoSvg {
  const d = dimDe(o);
  const ex = escalaLinear(0, Math.max(1, o.p95 * 1.1), d.l, d.W - d.r);
  const y = d.fluido ? Math.round(d.H * 0.5) : 90;
  const marca = (v: number, r: string, k: number): NoSvg[] => [
    no("line", { x1: r2(ex(v)), x2: r2(ex(v)), y1: y - 26, y2: y + 26, class: `ln-${k}`, "stroke-width": 2, "stroke-dasharray": TRACOS[k % NSERIES] || undefined, ...dadosTip(`${r}: ${formatarNumero(v)} ${o.unidade}`) }),
    no("text", { class: "rot", x: r2(Math.min(d.W - d.r - 20, Math.max(d.l + 14, ex(v)))), y: d.fluido ? y - 32 : y + 42, "text-anchor": "middle" }, r),
  ];
  const ticks = ticksY(0, o.p95 * 1.1, d.fluido ? Math.max(2, Math.min(6, Math.floor((d.W - d.l - d.r) / 60))) : 5).ticks;
  return moldura(o, [
    no("rect", { x: d.l, y: y - 8, width: r2(ex(o.p95) - d.l), height: 16, fill: `url(#${o.id}-p1)`, class: "ln-1 barra", "stroke-width": 1 }),
    ...ticks.map((t) => no("text", { class: "rot", x: r2(ex(t)), y: d.fluido ? y + 46 : y + 70, "text-anchor": "middle" }, formatarNumero(t))),
    d.fluido ? null : no("text", { class: "rot unidade", x: d.W - d.r, y: y + 86, "text-anchor": "end" }, o.unidade),
    ...marca(o.p50, o.r50, 2), ...marca(o.p85, o.r85, 3), ...marca(o.p95, o.r95, 4),
  ], d, d.fluido ? d.H : 190);
}
