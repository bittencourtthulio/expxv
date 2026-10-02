// Semente de posições pela árvore de pastas (puro): cada grupo (módulo) ganha uma célula numa espiral/grade e os membros
// ficam em torno dela. Estável: a mesma entrada dá as mesmas posições, o que mantém o layout previsível entre análises.
export interface PontoSemente { x: number; y: number }

function hashTexto(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function semearPorPasta(nos: ReadonlyArray<{ id: string; g: string }>): Map<string, PontoSemente> {
  const grupos = new Map<string, string[]>();
  for (const n of nos) {
    const l = grupos.get(n.g);
    if (l === undefined) grupos.set(n.g, [n.id]);
    else l.push(n.id);
  }
  const ordenados = [...grupos.keys()].sort();
  const lado = Math.max(1, Math.ceil(Math.sqrt(ordenados.length)));
  const maior = Math.max(1, ...[...grupos.values()].map((m) => m.length));
  const celula = 40 + Math.sqrt(maior) * 22;
  const saida = new Map<string, PontoSemente>();
  ordenados.forEach((g, k) => {
    const gx = (k % lado) * celula - (lado * celula) / 2;
    const gy = Math.floor(k / lado) * celula - (lado * celula) / 2;
    const membros = grupos.get(g) as string[];
    membros.forEach((id, i) => {
      const ang = ((hashTexto(id) % 3600) / 3600) * Math.PI * 2;
      const r = Math.sqrt((i + 1) / membros.length) * (celula * 0.4);
      saida.set(id, { x: gx + Math.cos(ang) * r, y: gy + Math.sin(ang) * r });
    });
  });
  return saida;
}

/** Vizinho cujo vetor mais se alinha com a seta (dx, dy); -1 se nenhum cabe num cone de 90 graus. */
export function proximoNaDirecao(xs: Float64Array, ys: Float64Array, atual: number, candidatos: readonly number[], dx: number, dy: number): number {
  let melhor = -1;
  let melhorScore = -Infinity;
  for (const c of candidatos) {
    if (c === atual) continue;
    const vx = (xs[c] as number) - (xs[atual] as number);
    const vy = (ys[c] as number) - (ys[atual] as number);
    const d = Math.hypot(vx, vy) || 1;
    const cos = (vx * dx + vy * dy) / d;
    if (cos < 0.5) continue;
    const score = cos - d / 10000;
    if (score > melhorScore) { melhor = c; melhorScore = score; }
  }
  return melhor;
}
