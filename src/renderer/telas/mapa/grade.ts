// Grade espacial para hit-test (puro): evita varrer todos os nós a cada movimento do mouse.
export interface Grade {
  celula: number;
  baldes: Map<number, number[]>;
  xs: Float64Array;
  ys: Float64Array;
  raios: Float64Array;
}

const chave = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768);

export function criarGrade(xs: Float64Array, ys: Float64Array, raios: Float64Array, celula = 48): Grade {
  const baldes = new Map<number, number[]>();
  for (let i = 0; i < xs.length; i++) {
    const k = chave(Math.floor((xs[i] as number) / celula), Math.floor((ys[i] as number) / celula));
    const b = baldes.get(k);
    if (b === undefined) baldes.set(k, [i]);
    else b.push(i);
  }
  return { celula, baldes, xs, ys, raios };
}

/** Nó mais próximo de (wx, wy) em coordenadas de mundo, dentro do raio (mundo) + folga; -1 se nenhum. */
export function acharNaGrade(g: Grade, wx: number, wy: number, folga = 3): number {
  const cx = Math.floor(wx / g.celula);
  const cy = Math.floor(wy / g.celula);
  let melhor = -1;
  let melhorD = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const b = g.baldes.get(chave(cx + dx, cy + dy));
      if (b === undefined) continue;
      for (const i of b) {
        const d = Math.hypot((g.xs[i] as number) - wx, (g.ys[i] as number) - wy);
        if (d <= (g.raios[i] as number) + folga && d < melhorD) { melhor = i; melhorD = d; }
      }
    }
  }
  return melhor;
}
