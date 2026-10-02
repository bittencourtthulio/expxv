// T-18.30: percentis por interpolação linear; amostra mínima (padrão 5) senão `poucos_dados`. Rótulo da UI: "duração observada".
import type { DispersaoTempo } from "../../../compartilhado/agil";
import { ordenar, percentilOrdenado } from "../util";

export function dispersao(amostras: readonly { ref: string; ms: number }[], minimo = 5): DispersaoTempo {
  const n = amostras.length;
  if (n < minimo) return { estado: "poucos_dados", n, p50: null, p85: null, p95: null, amostras: [...amostras] };
  const o = ordenar(amostras.map((a) => a.ms));
  return { estado: "ok", n, p50: percentilOrdenado(o, 50), p85: percentilOrdenado(o, 85), p95: percentilOrdenado(o, 95), amostras: [...amostras] };
}
