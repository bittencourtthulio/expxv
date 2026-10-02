// Seleção por proximidade na tela (puro): o nó mais perto do ponteiro, ponderado pelo alcance (nó grande é mais fácil de acertar).
import { projetar } from "./matematica";

/** `pos` xyz por nó; `ativo[i] > 0` = visível; `alcance[i]` multiplica a distância² (menor = mais fácil). -1 se ninguém dentro de `limitePx`. */
export function maisPerto(pos: ArrayLike<number>, ativo: ArrayLike<number>, alcance: ArrayLike<number>, m: ArrayLike<number>, w: number, h: number, x: number, y: number, limitePx = 18): number {
  let melhor = -1;
  let menor = limitePx * limitePx;
  let profMelhor = Infinity;
  const p = [0, 0, 0];
  const n = ativo.length;
  for (let i = 0; i < n; i++) {
    if (!((ativo[i] as number) > 0)) continue;
    projetar(m, pos[i * 3] as number, pos[i * 3 + 1] as number, pos[i * 3 + 2] as number, w, h, p);
    if ((p[2] as number) <= 0) continue;
    const dx = (p[0] as number) - x, dy = (p[1] as number) - y;
    const q = (dx * dx + dy * dy) * (alcance[i] as number);
    if (q < menor || (q === menor && (p[2] as number) < profMelhor)) { menor = q; melhor = i; profMelhor = p[2] as number; }
  }
  return melhor;
}
