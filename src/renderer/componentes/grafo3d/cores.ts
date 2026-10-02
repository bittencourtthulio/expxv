// Cores do grafo 3D (puro): lê tokens do app (var(--x)) e deriva a paleta das categorias. Nenhuma cor literal aqui (tokens-css).
export type RGB = [number, number, number];
export type LeitorVar = (nome: string) => string;

/** Converte a cor de um token (hex ou função rgb) para componentes 0..1; cor desconhecida devolve `padrao`. */
export function paraRgb(cor: string, padrao: RGB = [0.6, 0.6, 0.6]): RGB {
  const t = cor.trim();
  if (t.startsWith("#")) {
    const h = t.length === 4 || t.length === 5 ? [...t.slice(1, 4)].map((c) => c + c).join("") : t.slice(1, 7);
    const n = Number.parseInt(h, 16);
    return h.length === 6 && Number.isFinite(n) ? [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] : padrao;
  }
  const m = /^(\w+)\(([^)]*)\)/.exec(t);
  if (m !== null && (m[1] as string).startsWith("rgb")) {
    const p = (m[2] as string).split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (p.length === 3 && p.every(Number.isFinite)) return [(p[0] as number) / 255, (p[1] as number) / 255, (p[2] as number) / 255];
  }
  return padrao;
}

export const luminancia = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const misturar = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const nomeDoToken = (v: string): string => { const m = /^var\((--[\w-]+)\)$/.exec(v.trim()); return m === null ? v.trim() : (m[1] as string); };

export interface TemaGrafo { fundo: RGB; texto: RGB; discreto: RGB; destaque: RGB; alerta: RGB; claro: boolean }

export function lerTema(ler: LeitorVar): TemaGrafo {
  const fundo = paraRgb(ler("--fundo"), [0.09, 0.1, 0.1]);
  return { fundo, texto: paraRgb(ler("--texto"), [0.95, 0.95, 0.95]), discreto: paraRgb(ler("--texto-discreto"), [0.5, 0.5, 0.5]), destaque: paraRgb(ler("--destaque"), [0.15, 0.4, 0.94]), alerta: paraRgb(ler("--alerta"), [1, 0.4, 0.5]), claro: luminancia(fundo) > 0.5 };
}

/** Tokens de gráfico e de destaque, na ordem em que são atribuídos às categorias sem cor definida. */
export const TOKENS_CATEGORIA = ["--grafico-1", "--grafico-3", "--grafico-5", "--grafico-2", "--grafico-6", "--grafico-4", "--destaque-2", "--aviso", "--sucesso"] as const;

/** Token de cada categoria: `fixas` (categoria -> token) vence; as demais recebem os tokens em rodízio, na ordem dada. */
export function atribuirTokens(categorias: readonly string[], fixas: Readonly<Record<string, string>>): Map<string, string> {
  const saida = new Map<string, string>();
  let k = 0;
  for (const c of categorias) {
    if (saida.has(c)) continue;
    saida.set(c, fixas[c] !== undefined ? nomeDoToken(fixas[c] as string) : (TOKENS_CATEGORIA[k++ % TOKENS_CATEGORIA.length] as string));
  }
  return saida;
}

export function resolverPaleta(categorias: readonly string[], fixas: Readonly<Record<string, string>>, ler: LeitorVar): Map<string, RGB> {
  const saida = new Map<string, RGB>();
  for (const [c, token] of atribuirTokens(categorias, fixas)) saida.set(c, paraRgb(ler(token)));
  return saida;
}

/** Leitor de variáveis CSS no `:root` (tema atual); cai no padrão quando o ambiente não resolve. */
export const lerVarDoDocumento: LeitorVar = (nome) => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(nome).trim(); } catch { return ""; }
};
