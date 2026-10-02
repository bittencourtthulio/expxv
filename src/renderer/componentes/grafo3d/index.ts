// Grafo 3D "rede neural" (WebGL2 próprio, sem biblioteca; D-390): nós com brilho em shader, sinapses com cor por intensidade, pulsos
// de luz nas ligações fortes, poeira de profundidade, física que esfria, respiração, câmera orbital, clique enquadra o nó e os
// vizinhos, hover apaga o resto, rótulos HTML nos nós grandes, foto PNG e pausa com a aba oculta. Módulo carregado sob demanda.
import { lerTema, lerVarDoDocumento, misturar, resolverPaleta, type LeitorVar, type RGB } from "./cores";
import { Fisica, comprimentoDaMola } from "./fisica";
import { EL_MAX, limitarElevacao, matrizDaCamera, projetar, raioParaCaber, type Orbita } from "./matematica";
import { PASSO_LINHA, PASSO_PONTO, criarRenderizador } from "./render";
import { maisPerto } from "./selecao";

export interface No3D { id: string; rotulo: string; categoria: string; peso: number; grupo?: string; alerta?: boolean }
export interface Elo3D { a: string; b: string; peso?: number; alerta?: boolean }
export interface InfoPassar { id: string; x: number; y: number }
export interface OpcoesGrafo3D {
  nos: readonly No3D[];
  elos: readonly Elo3D[];
  /** categoria -> token (`--grafico-1` ou `var(--grafico-1)`); as que faltam recebem tokens em rodízio. */
  paleta?: Readonly<Record<string, string>>;
  lerVar?: LeitorVar;
  aoSelecionar?: (id: string | null) => void;
  aoPassar?: (info: InfoPassar | null) => void;
  /** duplo clique no nó. */
  aoAtivar?: (id: string) => void;
  /** o contexto WebGL foi perdido: a tela deve voltar ao modo simples. */
  aoFalhar?: () => void;
  reduzirMovimento?: boolean;
  maxRotulos?: number;
}
export interface GrafoMontado {
  filtra(pred: ((n: No3D) => boolean) | null): void;
  seleciona(id: string | null, silencioso?: boolean): void;
  reorganiza(): void;
  foto(): string;
  atualizaTema(): void;
  enquadra(): void;
  orbita(daz: number, del: number): void;
  zoom(fator: number): void;
  /** seleciona o próximo/anterior nó visível (por peso decrescente); devolve o id. */
  proximo(delta: 1 | -1): string | null;
  desmontar(): void;
}

const ALPHA_FORTE = { escuro: 0.34, claro: 0.5 }, ALPHA_FRACO = { escuro: 0.1, claro: 0.17 };
const rnd = (() => { let a = 12345; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();

export function montarGrafo3D(palco: HTMLElement, o: OpcoesGrafo3D): GrafoMontado {
  const ler = o.lerVar ?? lerVarDoDocumento;
  const calmo = o.reduzirMovimento === true;
  const nos = o.nos;
  const n = nos.length;
  const idx = new Map(nos.map((x, i) => [x.id, i]));
  const de: number[] = [], para: number[] = [], eloAlerta: boolean[] = [], pesoElo: number[] = [];
  for (const e of o.elos) { const a = idx.get(e.a), b = idx.get(e.b); if (a === undefined || b === undefined || a === b) continue; de.push(a); para.push(b); eloAlerta.push(e.alerta === true); pesoElo.push(e.peso ?? 1); }
  const E = de.length;
  const viz: number[][] = nos.map(() => []);
  const elosDe: number[][] = nos.map(() => []);
  for (let e = 0; e < E; e++) { (viz[de[e] as number] as number[]).push(para[e] as number); (viz[para[e] as number] as number[]).push(de[e] as number); (elosDe[de[e] as number] as number[]).push(e); (elosDe[para[e] as number] as number[]).push(e); }
  const grupos = new Map<string, number>();
  const grupoDe = Int32Array.from(nos, (x) => (x.grupo === undefined ? -1 : (grupos.get(x.grupo) ?? (grupos.set(x.grupo, grupos.size), grupos.size - 1))));
  const fisica = new Fisica({ n, de, para, grupo: grupoDe, semente: n * 31 + E });
  const L = comprimentoDaMola(n);
  if (calmo) for (let i = 0; i < 300 && !fisica.frio; i++) fisica.passo();

  // ---- estado visual ----
  let tema = lerTema(ler);
  const contagem = new Map<string, number>();
  for (const x of nos) contagem.set(x.categoria, (contagem.get(x.categoria) ?? 0) + 1);
  /** mesma ordem da legenda das telas: mais frequente primeiro, empate por nome (a cor automática segue essa ordem). */
  const categorias = [...contagem].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c]) => c);
  const cores = new Float32Array(n * 3), tam = new Float32Array(n), fase = new Float32Array(n), forca = new Float32Array(n), alvoForca = new Float32Array(n).fill(1), alcance = new Float32Array(n);
  const pesoMax = Math.max(1, ...nos.map((x) => x.peso));
  const corDoNo = (paleta: Map<string, RGB>, x: No3D): RGB => (x.alerta === true ? tema.alerta : (paleta.get(x.categoria) ?? tema.discreto));
  nos.forEach((x, i) => { const pw = Math.sqrt(Math.max(x.peso, 0) / pesoMax); tam[i] = L * (0.45 + 1.9 * pw); alcance[i] = pw > 0.5 ? 0.4 : 1; fase[i] = rnd() * 6.28; forca[i] = 1; });
  const ordem = [...nos.keys()].sort((a, b) => (nos[b] as No3D).peso - (nos[a] as No3D).peso || a - b);
  const limiarForte = (() => { const s = [...pesoElo].sort((a, b) => a - b); return s.length === 0 ? 0 : (s[Math.floor(s.length * 0.7)] as number); })();
  const forte = (e: number): boolean => eloAlerta[e] === true || (pesoElo[e] as number) >= limiarForte;
  const fortes = Array.from({ length: E }, (_, e) => e).filter(forte);

  const canvas = document.createElement("canvas");
  canvas.className = "g3d-cena";
  palco.prepend(canvas);
  const nPulsos = calmo || fortes.length === 0 ? 0 : Math.min(400, Math.max(30, fortes.length >> 1));
  const NP = 600;
  const gl = criarRenderizador(canvas, n, nPulsos, E, NP, () => o.aoFalhar?.());
  const P = gl.pontos.dados, Lh = gl.linhas.dados, PU = gl.pulsos.dados, PO = gl.poeira.dados;

  const pintaCores = (): void => {
    const paleta = resolverPaleta(categorias, o.paleta ?? {}, ler);
    nos.forEach((x, i) => { const c = corDoNo(paleta, x); cores[i * 3] = c[0]; cores[i * 3 + 1] = c[1]; cores[i * 3 + 2] = c[2]; P[i * PASSO_PONTO + 3] = c[0]; P[i * PASSO_PONTO + 4] = c[1]; P[i * PASSO_PONTO + 5] = c[2]; P[i * PASSO_PONTO + 6] = tam[i] as number; P[i * PASSO_PONTO + 8] = fase[i] as number; });
    gl.tema(tema.fundo, tema.claro ? misturar(tema.texto, tema.fundo, 0.15) : tema.texto, tema.claro);
  };
  pintaCores();
  const R0 = L * Math.cbrt(Math.max(n, 1)) * 3;
  for (let i = 0; i < NP; i++) { const z = rnd() * 2 - 1, a = rnd() * 6.283, r = Math.sqrt(1 - z * z), d = R0 * Math.cbrt(rnd()), k = i * PASSO_PONTO; PO[k] = r * Math.cos(a) * d; PO[k + 1] = z * d; PO[k + 2] = r * Math.sin(a) * d; PO[k + 6] = L * 0.14; PO[k + 7] = 0.45; PO[k + 8] = rnd() * 6; }
  const corPoeira = (): void => { for (let i = 0; i < NP; i++) { PO[i * PASSO_PONTO + 3] = tema.discreto[0]; PO[i * PASSO_PONTO + 4] = tema.discreto[1]; PO[i * PASSO_PONTO + 5] = tema.discreto[2]; } };
  corPoeira();

  // ---- rótulos dos nós grandes ----
  const rotulos = ordem.slice(0, Math.min(o.maxRotulos ?? 36, n)).map((i) => { const el = document.createElement("span"); el.className = "g3d-rotulo"; el.setAttribute("aria-hidden", "true"); el.textContent = (nos[i] as No3D).rotulo.length > 26 ? `${(nos[i] as No3D).rotulo.slice(0, 25)}…` : (nos[i] as No3D).rotulo; palco.append(el); return { i, el }; });

  // ---- filtro, foco e destaque ----
  let filtro: ((x: No3D) => boolean) | null = null, foco = -1, sobre = -1;
  const visivel = (i: number): boolean => filtro === null || filtro(nos[i] as No3D);
  function pinta(): void {
    const alvo = foco >= 0 ? foco : sobre;
    const perto = alvo >= 0 ? new Set<number>([alvo, ...(viz[alvo] as number[])]) : null;
    for (let i = 0; i < n; i++) alvoForca[i] = !visivel(i) ? 0 : perto === null ? 1 : perto.has(i) ? (i === alvo ? 1.9 : 1.35) : 0.1;
    const claro = tema.claro ? 1 : 0;
    for (let e = 0; e < E; e++) {
      const a = de[e] as number, b = para[e] as number;
      const on = (alvoForca[a] as number) > 0 && (alvoForca[b] as number) > 0;
      const quente = perto !== null && (a === alvo || b === alvo);
      const k = !on ? 0 : quente ? (claro ? 0.9 : 1) : perto !== null ? (claro ? 0.04 : 0.02) : forte(e) ? (claro ? ALPHA_FORTE.claro : ALPHA_FORTE.escuro) : (claro ? ALPHA_FRACO.claro : ALPHA_FRACO.escuro);
      for (let j = 0; j < 2; j++) {
        const v = j === 0 ? a : b, d = (e * 2 + j) * PASSO_LINHA;
        const c: RGB = eloAlerta[e] === true && !quente ? tema.alerta : quente ? misturar([cores[v * 3] as number, cores[v * 3 + 1] as number, cores[v * 3 + 2] as number], tema.destaque, 0.5) : [cores[v * 3] as number, cores[v * 3 + 1] as number, cores[v * 3 + 2] as number];
        Lh[d + 3] = c[0]; Lh[d + 4] = c[1]; Lh[d + 5] = c[2]; Lh[d + 6] = k;
      }
    }
  }

  // ---- câmera ----
  const orbita: Orbita = { az: 0.3, el: 0.25, raio: 260, centro: [0, 0, 0] };
  let alvoRaio = 260, alvoCentro: [number, number, number] = [0, 0, 0], auto = true, raioFechado = 260;
  const enquadraTudo = (): void => { const env = fisica.envoltoria(); alvoCentro = env.centro; raioFechado = raioParaCaber(env.raio); alvoRaio = raioFechado; auto = true; };
  enquadraTudo(); orbita.raio = alvoRaio * 1.6; orbita.centro = [...alvoCentro];
  function enquadraFoco(): void {
    if (foco < 0) { enquadraTudo(); return; }
    const grupo = [foco, ...(viz[foco] as number[]).filter((v) => (alvoForca[v] as number) > 0)];
    let cx = 0, cy = 0, cz = 0;
    for (const g of grupo) { cx += fisica.pos[g * 3] as number; cy += fisica.pos[g * 3 + 1] as number; cz += fisica.pos[g * 3 + 2] as number; }
    cx /= grupo.length; cy /= grupo.length; cz /= grupo.length;
    const fx = fisica.pos[foco * 3] as number, fy = fisica.pos[foco * 3 + 1] as number, fz = fisica.pos[foco * 3 + 2] as number;
    const c: [number, number, number] = [cx + (fx - cx) * 0.35, cy + (fy - cy) * 0.35, cz + (fz - cz) * 0.35];
    let alc = 0;
    for (const g of grupo) alc = Math.max(alc, Math.hypot((fisica.pos[g * 3] as number) - c[0], (fisica.pos[g * 3 + 1] as number) - c[1], (fisica.pos[g * 3 + 2] as number) - c[2]));
    alvoCentro = c; alvoRaio = Math.max(L * 4, Math.min(raioFechado * 1.6, raioParaCaber(alc + L, 1.5))); auto = false;
  }
  function seleciona(i: number, silencioso = false): void {
    foco = i >= 0 && foco !== i ? i : -1;
    pinta(); enquadraFoco();
    if (!silencioso) o.aoSelecionar?.(foco >= 0 ? (nos[foco] as No3D).id : null);
  }

  // ---- ponteiro ----
  let largura = 1, altura = 1, dpr = 1;
  const vp = new Float32Array(16);
  let arrasto: { x: number; y: number; az: number; el: number; andou: number } | null = null, ponteiro: { x: number; y: number } | null = null;
  const local = (ev: PointerEvent | MouseEvent | WheelEvent): { x: number; y: number } => { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  const pega = (x: number, y: number): number => maisPerto(fisica.pos, forca, alcance, vp, largura, altura, x, y);
  const aoPressionar = (ev: PointerEvent): void => { arrasto = { x: ev.clientX, y: ev.clientY, az: orbita.az, el: orbita.el, andou: 0 }; try { canvas.setPointerCapture(ev.pointerId); } catch { /* sem captura */ } };
  const aoMover = (ev: PointerEvent): void => {
    if (arrasto !== null) { arrasto.andou = Math.hypot(ev.clientX - arrasto.x, ev.clientY - arrasto.y); if (arrasto.andou >= 5) { auto = false; orbita.az = arrasto.az - (ev.clientX - arrasto.x) * 0.005; orbita.el = limitarElevacao(arrasto.el + (ev.clientY - arrasto.y) * 0.004); } return; }
    ponteiro = local(ev);
  };
  const aoSair = (): void => { ponteiro = null; if (sobre >= 0) { sobre = -1; if (foco < 0) pinta(); o.aoPassar?.(null); } };
  const aoSoltar = (ev: PointerEvent): void => { const clique = arrasto !== null && arrasto.andou < 5; arrasto = null; if (clique) { const p = local(ev); seleciona(pega(p.x, p.y)); } };
  const aoDuplo = (ev: MouseEvent): void => { const p = local(ev); const i = pega(p.x, p.y); if (i >= 0) o.aoAtivar?.((nos[i] as No3D).id); };
  const aoRoda = (ev: WheelEvent): void => { ev.preventDefault(); auto = false; alvoRaio = Math.max(L * 3, Math.min(raioFechado * 2.4, alvoRaio * (1 + ev.deltaY * 0.0012))); };
  canvas.addEventListener("pointerdown", aoPressionar); canvas.addEventListener("pointermove", aoMover); canvas.addEventListener("pointerleave", aoSair);
  canvas.addEventListener("pointerup", aoSoltar); canvas.addEventListener("dblclick", aoDuplo); canvas.addEventListener("wheel", aoRoda, { passive: false });

  const ajusta = (): void => { largura = Math.max(1, palco.clientWidth); altura = Math.max(1, palco.clientHeight); dpr = Math.min(globalThis.devicePixelRatio || 1, 2); gl.redimensionar(largura, altura, dpr); };
  const observa = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(ajusta);
  observa?.observe(palco); ajusta(); pinta();
  forca.set(alvoForca);

  // ---- pulsos ----
  const pulsos = Array.from({ length: nPulsos }, () => ({ e: 0, t: rnd(), vel: 0, ida: true }));
  const novoPulso = (p: { e: number; t: number; vel: number; ida: boolean }, ponta: number): void => {
    const opcoes = ponta >= 0 ? (elosDe[ponta] as number[]).filter((e) => forte(e) && (alvoForca[de[e] as number] as number) > 0 && (alvoForca[para[e] as number] as number) > 0) : [];
    p.e = opcoes.length > 0 && rnd() < 0.82 ? (opcoes[(rnd() * opcoes.length) | 0] as number) : (fortes[(rnd() * fortes.length) | 0] as number);
    p.ida = ponta >= 0 && de[p.e] === ponta ? true : ponta >= 0 && para[p.e] === ponta ? false : rnd() < 0.5;
    p.t = 0; p.vel = 0.35 + rnd() * 0.75;
  };
  pulsos.forEach((p) => { novoPulso(p, -1); p.t = rnd(); });

  // ---- laço ----
  let rodando = true, quadro = 0, conta = 0, ultimo = performance.now(), tempo = 0;
  const m = vp;
  const proj = [0, 0, 0];
  function anima(): void {
    if (!rodando) return;
    quadro = requestAnimationFrame(anima);
    const agora = performance.now(), dt = Math.min((agora - ultimo) / 1000, 0.05);
    ultimo = agora; tempo += dt; conta++;
    if (!fisica.frio) fisica.rodar(5);
    const b = calmo ? 0 : L * 0.05, pos = fisica.pos;
    for (let i = 0; i < n; i++) {
      forca[i] = (forca[i] as number) + ((alvoForca[i] as number) - (forca[i] as number)) * 0.2;
      const k = i * PASSO_PONTO, f = fase[i] as number;
      P[k] = (pos[i * 3] as number) + Math.sin(tempo * 0.5 + f) * b; P[k + 1] = (pos[i * 3 + 1] as number) + Math.cos(tempo * 0.43 + f * 1.3) * b; P[k + 2] = (pos[i * 3 + 2] as number) + Math.sin(tempo * 0.37 + f * 0.7) * b; P[k + 7] = forca[i] as number;
    }
    for (let e = 0; e < E; e++) {
      const a = (de[e] as number) * PASSO_PONTO, c = (para[e] as number) * PASSO_PONTO, d = e * 2 * PASSO_LINHA;
      Lh[d] = P[a] as number; Lh[d + 1] = P[a + 1] as number; Lh[d + 2] = P[a + 2] as number;
      Lh[d + PASSO_LINHA] = P[c] as number; Lh[d + PASSO_LINHA + 1] = P[c + 1] as number; Lh[d + PASSO_LINHA + 2] = P[c + 2] as number;
    }
    const alvoDim = foco >= 0 ? foco : sobre;
    for (let i = 0; i < nPulsos; i++) {
      const p = pulsos[i] as (typeof pulsos)[number];
      p.t += dt * p.vel;
      if (p.t >= 1 || (alvoForca[de[p.e] as number] as number) <= 0 || (alvoForca[para[p.e] as number] as number) <= 0) novoPulso(p, p.ida ? (para[p.e] as number) : (de[p.e] as number));
      const ini = (p.ida ? (de[p.e] as number) : (para[p.e] as number)) * PASSO_PONTO, fim = (p.ida ? (para[p.e] as number) : (de[p.e] as number)) * PASSO_PONTO, s = p.t * p.t * (3 - 2 * p.t), k = i * PASSO_PONTO;
      PU[k] = (P[ini] as number) + ((P[fim] as number) - (P[ini] as number)) * s; PU[k + 1] = (P[ini + 1] as number) + ((P[fim + 1] as number) - (P[ini + 1] as number)) * s; PU[k + 2] = (P[ini + 2] as number) + ((P[fim + 2] as number) - (P[ini + 2] as number)) * s;
      const v = ini / PASSO_PONTO;
      const cc = misturar([cores[v * 3] as number, cores[v * 3 + 1] as number, cores[v * 3 + 2] as number], tema.claro ? tema.texto : [1, 1, 1], 0.45);
      PU[k + 3] = cc[0]; PU[k + 4] = cc[1]; PU[k + 5] = cc[2]; PU[k + 6] = L * 0.11; PU[k + 8] = i;
      PU[k + 7] = Math.sin(p.t * Math.PI) * (alvoDim >= 0 && de[p.e] !== alvoDim && para[p.e] !== alvoDim ? 0.12 : 1);
    }
    if (conta % 20 === 0 && auto && (!fisica.frio || conta < 120)) { const env = fisica.envoltoria(); alvoCentro = env.centro; raioFechado = raioParaCaber(env.raio); alvoRaio = raioFechado; }
    if (foco >= 0 && !fisica.frio && conta % 30 === 0) enquadraFoco();
    if (arrasto === null && !calmo && foco < 0 && auto) orbita.az += dt * 0.05;
    orbita.raio += (alvoRaio - orbita.raio) * 0.06;
    for (let c = 0; c < 3; c++) (orbita.centro as number[])[c] = (orbita.centro[c] as number) + ((alvoCentro[c] as number) - (orbita.centro[c] as number)) * 0.06;
    orbita.el = Math.max(-EL_MAX, Math.min(EL_MAX, orbita.el));
    matrizDaCamera(orbita, largura, altura, m);
    if (ponteiro !== null && arrasto === null && conta % 3 === 0) {
      const i = pega(ponteiro.x, ponteiro.y);
      if (i !== sobre) { sobre = i; canvas.style.cursor = i >= 0 ? "pointer" : "grab"; if (foco < 0) pinta(); o.aoPassar?.(i >= 0 ? { id: (nos[i] as No3D).id, x: ponteiro.x, y: ponteiro.y } : null); }
    }
    for (const r of rotulos) {
      projetar(m, pos[r.i * 3] as number, pos[r.i * 3 + 1] as number, pos[r.i * 3 + 2] as number, largura, altura, proj);
      const some = (proj[2] as number) <= 0 || (forca[r.i] as number) < 0.05;
      if (some) { if (r.el.style.display !== "none") r.el.style.display = "none"; continue; }
      if (r.el.style.display === "none") r.el.style.display = "";
      const w = proj[2] as number;
      r.el.style.transform = `translate(-50%, 0) translate(${(proj[0] as number).toFixed(1)}px, ${((proj[1] as number) + 8 + ((tam[r.i] as number) * 220 * (altura / 800)) / w).toFixed(1)}px)`;
      r.el.style.opacity = String(Math.max(0.12, Math.min(1, (alvoDim >= 0 && (forca[r.i] as number) < 1 ? 0.18 : 1) * (1.35 - w / (raioFechado * 2.4)))));
      r.el.style.zIndex = String(1000 - Math.round(w));
    }
    const estado = { vp: m, tempo, escala: 430 * (altura / 800) * dpr, nevoa: (0.0026 * 185) / Math.max(orbita.raio, 1) };
    gl.desenhar(estado);
  }
  anima();
  const aoVisibilidade = (): void => { if (document.hidden) { rodando = false; cancelAnimationFrame(quadro); } else if (!rodando) { rodando = true; ultimo = performance.now(); anima(); } };
  document.addEventListener("visibilitychange", aoVisibilidade);

  return {
    filtra(pred) { filtro = pred; if (foco >= 0 && !visivel(foco)) seleciona(foco); else pinta(); },
    seleciona(id, silencioso = false) { const i = id === null ? -1 : (idx.get(id) ?? -1); if (i < 0) { if (foco >= 0) { foco = -1; pinta(); enquadraFoco(); } return; } if (i !== foco) seleciona(i, silencioso); },
    reorganiza() { fisica.reaquecer(1); for (let i = 0; i < n * 3; i++) fisica.vel[i] = (fisica.vel[i] as number) + (rnd() - 0.5) * L * 0.4; },
    foto() { return gl.foto({ vp: m, tempo, escala: 430 * (altura / 800) * dpr, nevoa: (0.0026 * 185) / Math.max(orbita.raio, 1) }, tema.fundo); },
    atualizaTema() { tema = lerTema(ler); pintaCores(); corPoeira(); pinta(); },
    enquadra() { foco = -1; pinta(); enquadraTudo(); },
    orbita(daz, del) { auto = false; orbita.az += daz; orbita.el = limitarElevacao(orbita.el + del); },
    zoom(f) { auto = false; alvoRaio = Math.max(L * 3, Math.min(raioFechado * 2.4, alvoRaio * f)); },
    proximo(delta) {
      const vis = ordem.filter(visivel);
      if (vis.length === 0) return null;
      const at = vis.indexOf(foco);
      const i = vis[at < 0 ? (delta === 1 ? 0 : vis.length - 1) : (at + delta + vis.length) % vis.length] as number;
      foco = -1; seleciona(i);
      return (nos[i] as No3D).id;
    },
    desmontar() {
      rodando = false; cancelAnimationFrame(quadro); observa?.disconnect(); document.removeEventListener("visibilitychange", aoVisibilidade);
      canvas.removeEventListener("pointerdown", aoPressionar); canvas.removeEventListener("pointermove", aoMover); canvas.removeEventListener("pointerleave", aoSair);
      canvas.removeEventListener("pointerup", aoSoltar); canvas.removeEventListener("dblclick", aoDuplo); canvas.removeEventListener("wheel", aoRoda);
      gl.descartar(); canvas.remove(); for (const r of rotulos) r.el.remove();
    },
  };
}
