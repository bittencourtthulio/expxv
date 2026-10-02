// Nível de detalhe do grafo (puro): rótulos só com zoom suficiente; com muitas arestas visíveis só as da seleção.
export const ZOOM_ROTULOS = 0.8;
export const LIMITE_ARESTAS_VISIVEIS = 3000;
export const MAX_ROTULOS_MAPA = 200;

export const mostrarRotulos = (zoom: number): boolean => zoom >= ZOOM_ROTULOS;

export interface Retangulo { x0: number; y0: number; x1: number; y1: number }

export function dentro(r: Retangulo, x: number, y: number, folga = 0): boolean {
  return x >= r.x0 - folga && x <= r.x1 + folga && y >= r.y0 - folga && y <= r.y1 + folga;
}

/** Retângulo do mundo visível na tela (w x h) para a câmera. */
export function retanguloVisivel(cx: number, cy: number, zoom: number, w: number, h: number): Retangulo {
  return { x0: cx - w / 2 / zoom, y0: cy - h / 2 / zoom, x1: cx + w / 2 / zoom, y1: cy + h / 2 / zoom };
}

/** Índices dos nós dentro do retângulo (culling). */
export function nosVisiveis(xs: Float64Array, ys: Float64Array, r: Retangulo, folga = 20): number[] {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) if (dentro(r, xs[i] as number, ys[i] as number, folga)) out.push(i);
  return out;
}

export interface EscolhaArestas { indices: number[]; reduzido: boolean }

/** Arestas a desenhar: visíveis (uma ponta visível); acima do limite, só as que tocam a seleção. */
export function escolherArestas(de: ArrayLike<number>, para: ArrayLike<number>, visivel: ReadonlySet<number>, selecionados: ReadonlySet<number>, limite = LIMITE_ARESTAS_VISIVEIS): EscolhaArestas {
  const vis: number[] = [];
  for (let e = 0; e < de.length; e++) if (visivel.has(de[e] as number) || visivel.has(para[e] as number)) vis.push(e);
  if (vis.length <= limite) return { indices: vis, reduzido: false };
  return { indices: vis.filter((e) => selecionados.has(de[e] as number) || selecionados.has(para[e] as number)), reduzido: true };
}

/** Rótulos: seleção/vizinhança sempre; o resto por peso, só com zoom >= 0,8 e até o teto. */
export function escolherRotulos(ids: readonly string[], pesos: ArrayLike<number>, visiveis: readonly number[], forcados: ReadonlySet<number>, zoom: number, max = MAX_ROTULOS_MAPA): number[] {
  const fortes = visiveis.filter((i) => forcados.has(i));
  if (!mostrarRotulos(zoom)) return fortes.slice(0, max);
  const resto = visiveis.filter((i) => !forcados.has(i)).sort((a, b) => (pesos[b] as number) - (pesos[a] as number) || (ids[a] as string).localeCompare(ids[b] as string));
  return [...fortes, ...resto.slice(0, Math.max(0, max - fortes.length))];
}
