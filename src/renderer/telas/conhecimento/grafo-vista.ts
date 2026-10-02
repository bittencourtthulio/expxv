// Vista do grafo (puro): câmera pan/zoom, conversão mundo<->tela, hit-test, escolha de rótulos e enquadramento.
export interface Camera { cx: number; cy: number; zoom: number }
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 8;
export const MAX_ROTULOS = 250;

export const CAMERA_PADRAO: Camera = { cx: 0, cy: 0, zoom: 1 };
const limitar = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export function mundoParaTela(c: Camera, w: number, h: number, x: number, y: number): [number, number] {
  return [(x - c.cx) * c.zoom + w / 2, (y - c.cy) * c.zoom + h / 2];
}
export function telaParaMundo(c: Camera, w: number, h: number, sx: number, sy: number): [number, number] {
  return [(sx - w / 2) / c.zoom + c.cx, (sy - h / 2) / c.zoom + c.cy];
}
/** Zoom multiplicativo mantendo o ponto (px, py) da tela parado. */
export function zoomEm(c: Camera, w: number, h: number, px: number, py: number, fator: number): Camera {
  const zoom = limitar(c.zoom * fator);
  const [wx, wy] = telaParaMundo(c, w, h, px, py);
  return { zoom, cx: wx - (px - w / 2) / zoom, cy: wy - (py - h / 2) / zoom };
}
export function deslocar(c: Camera, dxTela: number, dyTela: number): Camera {
  return { ...c, cx: c.cx - dxTela / c.zoom, cy: c.cy - dyTela / c.zoom };
}

/** Raio (px de mundo) do nó pelo peso. */
export const raioDoNo = (peso: number): number => 4 + Math.min(Math.sqrt(Math.max(peso, 0)) * 1.4, 9);

/** Índice do nó sob (px, py) — o de centro mais próximo dentro do raio na tela + 3 px; -1 se nenhum. */
export function acharNo(xs: Float64Array, ys: Float64Array, raios: Float64Array, c: Camera, w: number, h: number, px: number, py: number): number {
  let melhor = -1;
  let melhorD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const [sx, sy] = mundoParaTela(c, w, h, xs[i] as number, ys[i] as number);
    const d = Math.hypot(sx - px, sy - py);
    const r = Math.max((raios[i] as number) * c.zoom, 3) + 3;
    if (d <= r && d < melhorD) { melhor = i; melhorD = d; }
  }
  return melhor;
}

/** Até `max` ids a rotular: só os visíveis, por peso decrescente; `forcados` (seleção/hover) sempre entram. */
export function selecionarRotulos(nos: ReadonlyArray<{ id: string; x: number; y: number; peso: number }>, c: Camera, w: number, h: number, max: number, forcados: ReadonlySet<string>): string[] {
  const forcadosVisiveis: string[] = [];
  const candidatos: Array<{ id: string; peso: number }> = [];
  for (const no of nos) {
    if (forcados.has(no.id)) { forcadosVisiveis.push(no.id); continue; }
    const [sx, sy] = mundoParaTela(c, w, h, no.x, no.y);
    if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
    candidatos.push({ id: no.id, peso: no.peso });
  }
  candidatos.sort((a, b) => b.peso - a.peso || (a.id < b.id ? -1 : 1));
  return [...forcadosVisiveis, ...candidatos.slice(0, Math.max(0, max - forcadosVisiveis.length)).map((k) => k.id)];
}

export function enquadrar(xs: Float64Array, ys: Float64Array, w: number, h: number, margem: number): Camera {
  if (xs.length === 0) return { ...CAMERA_PADRAO };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as number, y = ys[i] as number;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const lw = Math.max(maxX - minX, 1), lh = Math.max(maxY - minY, 1);
  const zoom = limitar(Math.min((w - 2 * margem) / lw, (h - 2 * margem) / lh, 2));
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, zoom };
}
