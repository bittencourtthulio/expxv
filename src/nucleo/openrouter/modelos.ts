// Tradução modelo → faixa (T-09.26/11). Nomes de modelo são DADO: a faixa é uma SUGESTÃO por preço de saída (USD por milhão de tokens),
// com limiares em dados abaixo. Quem decide a faixa e a ordem é o dono (`openrouter_modelo_gravar`); o código só conhece as faixas.
import type { Faixa } from "../../compartilhado/harness";

/** Limiares por preço de saída (US$/Mtok), do mais caro ao mais barato. Editáveis aqui; nada depende de nome de modelo. */
export const LIMIARES_FAIXA_POR_PRECO_SAIDA: ReadonlyArray<readonly [number, Faixa]> = [
  [40, "topo"],
  [10, "alto"],
  [1.5, "medio"],
  [0, "rapido"],
];

export function sugerirFaixa(m: { preco_saida_por_mtok: number | null }): Faixa | null {
  const p = m.preco_saida_por_mtok;
  if (p === null || !Number.isFinite(p) || p < 0) return null; // sem preço: sem sugestão (nunca "grátis" por omissão)
  for (const [minimo, faixa] of LIMIARES_FAIXA_POR_PRECO_SAIDA) if (p >= minimo) return faixa;
  return null;
}
