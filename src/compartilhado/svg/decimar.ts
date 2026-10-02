// Decimação (puro): mantém o formato da série com no máximo `max` pontos. Por balde guarda primeiro, mínimo, máximo e último (na ordem original),
// então picos e vales nunca somem. Pontos `null` (lacuna) quebram a linha: entram como estão e contam no orçamento.
export function decimar<T>(pontos: readonly T[], max: number, y: (p: T) => number | null): T[] {
  const n = pontos.length;
  if (max < 4) max = 4;
  if (n <= max) return [...pontos];
  const baldes = Math.max(1, Math.floor(max / 4));
  const tam = Math.ceil(n / baldes);
  const out: T[] = [];
  for (let ini = 0; ini < n; ini += tam) {
    const fim = Math.min(n, ini + tam);
    let iMin = -1; let iMax = -1;
    for (let i = ini; i < fim; i++) {
      const v = y(pontos[i] as T);
      if (v === null) continue;
      if (iMin < 0 || v < (y(pontos[iMin] as T) as number)) iMin = i;
      if (iMax < 0 || v > (y(pontos[iMax] as T) as number)) iMax = i;
    }
    const idx = [...new Set([ini, iMin, iMax, fim - 1].filter((i) => i >= 0))].sort((a, b) => a - b);
    for (const i of idx) out.push(pontos[i] as T);
  }
  return out;
}

/** índices uniformes (para áreas de interação): no máximo `max`, sempre com o primeiro e o último. */
export function amostrarIndices(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const passo = (n - 1) / (max - 1);
  const set = new Set<number>();
  for (let i = 0; i < max; i++) set.add(Math.round(i * passo));
  return [...set];
}
