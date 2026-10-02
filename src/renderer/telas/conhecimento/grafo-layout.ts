// Layout de forças do grafo (Fase 15): função PURA, determinística por semente, sem DOM. Repulsão por quadtree (Barnes-Hut
// simplificado), molas nas arestas, gravidade ao centro e resfriamento. Roda em fatias de tempo (`fatia`) no renderer.
import type { ArestaGrafo, NoGrafo } from "../../../compartilhado/conhecimento";

export interface Simulacao {
  n: number;
  ids: string[];
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  massa: Float64Array;
  fixo: Uint8Array;
  /** pares (origem, destino) como índices. */
  pares: Int32Array;
  alfa: number;
}

export interface OpcoesSimulacao { semente?: string; fixos?: ReadonlySet<string> }

const REPULSAO = 900;
const MOLA = 0.04;
const COMPRIMENTO = 55;
const GRAVIDADE = 0.012;
const AMORTECIMENTO = 0.82;
const THETA2 = 0.81; // theta = 0.9
const ALFA_MIN = 0.02;
const VEL_MAX = 40;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** mulberry32. */
function aleatorio(semente: string): () => number {
  let a = hash(semente) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function criarSimulacao(nos: readonly NoGrafo[], arestas: readonly ArestaGrafo[], op: OpcoesSimulacao = {}): Simulacao {
  const n = nos.length;
  const rnd = aleatorio(op.semente ?? "expx");
  const indice = new Map<string, number>();
  nos.forEach((no, i) => indice.set(no.id, i));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const raio = 18 * Math.sqrt(Math.max(n, 1));
  nos.forEach((no, i) => {
    if (no.x !== null && no.y !== null && Number.isFinite(no.x) && Number.isFinite(no.y)) { x[i] = no.x; y[i] = no.y; return; }
    const ang = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * raio;
    x[i] = Math.cos(ang) * r;
    y[i] = Math.sin(ang) * r;
  });
  const pares: number[] = [];
  for (const a of arestas) {
    const i = indice.get(a.origem);
    const j = indice.get(a.destino);
    if (i !== undefined && j !== undefined && i !== j) pares.push(i, j);
  }
  const massa = new Float64Array(n);
  const fixo = new Uint8Array(n);
  nos.forEach((no, i) => { massa[i] = 1 + Math.min(Math.max(no.peso, 0), 20) * 0.1; if (op.fixos?.has(no.id) === true) fixo[i] = 1; });
  return { n, ids: nos.map((no) => no.id), x, y, vx: new Float64Array(n), vy: new Float64Array(n), massa, fixo, pares: Int32Array.from(pares), alfa: 1 };
}

interface Quad {
  x0: number; y0: number; lado: number;
  massa: number; cx: number; cy: number;
  no: number; // folha com um nó (índice) ou -1
  filhos: Array<Quad | null> | null;
}
const novoQuad = (x0: number, y0: number, lado: number): Quad => ({ x0, y0, lado, massa: 0, cx: 0, cy: 0, no: -1, filhos: null });

function inserir(q: Quad, i: number, s: Simulacao, prof: number): void {
  const px = s.x[i] as number;
  const py = s.y[i] as number;
  const m = s.massa[i] as number;
  if (q.massa === 0) { q.massa = m; q.cx = px; q.cy = py; q.no = i; return; }
  // atualiza o centro de massa
  const total = q.massa + m;
  q.cx = (q.cx * q.massa + px * m) / total;
  q.cy = (q.cy * q.massa + py * m) / total;
  q.massa = total;
  if (prof > 28) { q.no = -2; return; } // pontos praticamente coincidentes: agrega
  if (q.filhos === null) {
    q.filhos = [null, null, null, null];
    if (q.no >= 0) { const antigo = q.no; q.no = -1; descer(q, antigo, s, prof); }
  }
  descer(q, i, s, prof);
}
function descer(q: Quad, i: number, s: Simulacao, prof: number): void {
  const meio = q.lado / 2;
  const dx = (s.x[i] as number) >= q.x0 + meio ? 1 : 0;
  const dy = (s.y[i] as number) >= q.y0 + meio ? 1 : 0;
  const k = dy * 2 + dx;
  const filhos = q.filhos as Array<Quad | null>;
  let f = filhos[k];
  if (f === null || f === undefined) { f = novoQuad(q.x0 + dx * meio, q.y0 + dy * meio, meio); filhos[k] = f; }
  inserir(f, i, s, prof + 1);
}

function repulsao(q: Quad, i: number, s: Simulacao, alfa: number, fx: Float64Array, fy: Float64Array): void {
  if (q.massa === 0 || q.no === i) return;
  let dx = (s.x[i] as number) - q.cx;
  let dy = (s.y[i] as number) - q.cy;
  let d2 = dx * dx + dy * dy;
  const folha = q.filhos === null;
  if (folha || (q.lado * q.lado) / (d2 || 1) < THETA2) {
    if (d2 < 1) { dx = (i % 2 === 0 ? 1 : -1) * 0.5; dy = (i % 3 === 0 ? 1 : -1) * 0.5; d2 = 1; }
    const f = (REPULSAO * q.massa * (s.massa[i] as number) * alfa) / d2;
    const d = Math.sqrt(d2);
    fx[i] = (fx[i] as number) + (dx / d) * f;
    fy[i] = (fy[i] as number) + (dy / d) * f;
    return;
  }
  for (const f of q.filhos as Array<Quad | null>) if (f !== null) repulsao(f, i, s, alfa, fx, fy);
}

/** Um passo; devolve a energia cinética média (zero = parado). */
export function avancar(s: Simulacao): number {
  const n = s.n;
  if (n === 0) return 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = s.x[i] as number, py = s.y[i] as number;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  const lado = Math.max(maxX - minX, maxY - minY, 1) + 2;
  const raiz = novoQuad(minX - 1, minY - 1, lado);
  for (let i = 0; i < n; i++) inserir(raiz, i, s, 0);
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  for (let i = 0; i < n; i++) repulsao(raiz, i, s, s.alfa, fx, fy);
  for (let k = 0; k < s.pares.length; k += 2) {
    const a = s.pares[k] as number, b = s.pares[k + 1] as number;
    const dx = (s.x[b] as number) - (s.x[a] as number);
    const dy = (s.y[b] as number) - (s.y[a] as number);
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const f = (d - COMPRIMENTO) * MOLA * s.alfa;
    const ux = (dx / d) * f, uy = (dy / d) * f;
    fx[a] = (fx[a] as number) + ux; fy[a] = (fy[a] as number) + uy;
    fx[b] = (fx[b] as number) - ux; fy[b] = (fy[b] as number) - uy;
  }
  let e = 0;
  for (let i = 0; i < n; i++) {
    if (s.fixo[i] === 1) { s.vx[i] = 0; s.vy[i] = 0; continue; }
    fx[i] = (fx[i] as number) - (s.x[i] as number) * GRAVIDADE * s.alfa;
    fy[i] = (fy[i] as number) - (s.y[i] as number) * GRAVIDADE * s.alfa;
    let vx = ((s.vx[i] as number) + (fx[i] as number) / (s.massa[i] as number)) * AMORTECIMENTO;
    let vy = ((s.vy[i] as number) + (fy[i] as number) / (s.massa[i] as number)) * AMORTECIMENTO;
    const v = Math.hypot(vx, vy);
    if (v > VEL_MAX) { vx = (vx / v) * VEL_MAX; vy = (vy / v) * VEL_MAX; }
    s.vx[i] = vx; s.vy[i] = vy;
    s.x[i] = (s.x[i] as number) + vx;
    s.y[i] = (s.y[i] as number) + vy;
    e += vx * vx + vy * vy;
  }
  s.alfa = Math.max(ALFA_MIN, s.alfa * 0.985);
  return e / n;
}

export function energia(s: Simulacao): number {
  let e = 0;
  for (let i = 0; i < s.n; i++) e += (s.vx[i] as number) ** 2 + (s.vy[i] as number) ** 2;
  return s.n === 0 ? 0 : e / s.n;
}

const LIMIAR_ESTAVEL = 0.05;

export function rodarAte(s: Simulacao, op: { maxPassos: number; limiar?: number }): { passos: number; estavel: boolean } {
  if (s.n === 0) return { passos: 0, estavel: true };
  const limiar = op.limiar ?? LIMIAR_ESTAVEL;
  for (let p = 1; p <= op.maxPassos; p++) {
    const e = avancar(s);
    if (s.alfa <= ALFA_MIN * 1.2 && e < limiar) return { passos: p, estavel: true };
  }
  return { passos: op.maxPassos, estavel: false };
}

/** Passos até esgotar o orçamento de tempo (ms), com relógio injetável; no mínimo um passo. */
export function fatia(s: Simulacao, orcamentoMs: number, agora: () => number = () => performance.now(), limiar = LIMIAR_ESTAVEL): { passos: number; estavel: boolean } {
  if (s.n === 0) return { passos: 0, estavel: true };
  const t0 = agora();
  let passos = 0;
  let e = Infinity;
  do { e = avancar(s); passos++; } while (agora() - t0 < orcamentoMs);
  return { passos, estavel: s.alfa <= ALFA_MIN * 1.2 && e < limiar };
}

export function posicoesDe(s: Simulacao): Array<{ id: string; x: number; y: number }> {
  return s.ids.map((id, i) => ({ id, x: s.x[i] as number, y: s.y[i] as number }));
}
