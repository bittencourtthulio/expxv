// Utilitários de contraste WCAG 2.x (só para teste: nada disto entra no bundle).
export interface RGB { r: number; g: number; b: number }

export function lerHex(hex: string): RGB {
  const h = hex.trim().toLowerCase();
  const m = /^#([0-9a-f]{6})$/.exec(h) ?? /^#([0-9a-f]{3})$/.exec(h);
  if (m === null) throw new Error(`cor hex inválida: ${hex}`);
  const d = m[1] as string;
  const c = d.length === 3 ? [...d].map((x) => x + x).join("") : d;
  const n = parseInt(c, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Cor com alfa sobre um fundo opaco (rgba de `--borda`, color-mix de tintas). */
export function misturar(topo: RGB, alfa: number, fundo: RGB): RGB {
  const f = (a: number, b: number) => Math.round(a * alfa + b * (1 - alfa));
  return { r: f(topo.r, fundo.r), g: f(topo.g, fundo.g), b: f(topo.b, fundo.b) };
}

const linear = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminancia = (c: RGB): number => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);

export function razao(a: RGB, b: RGB): number {
  const x = luminancia(a);
  const y = luminancia(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
