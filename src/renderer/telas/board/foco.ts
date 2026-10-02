// Navegação por setas no Board (T-10.30): ↑/↓ entre cards da coluna, ←/→ para a coluna vizinha (mesma posição, ou a última), Home/End nas pontas.
// As colunas são virtualizadas: o card de destino pode não estar no DOM; rola a lista e foca quando ele aparecer. Nunca rouba o foco do terminal (só reage a tecla dentro do board).

export type Seta = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";
export const ehSeta = (k: string): k is Seta => ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(k);

export interface Posicao { coluna: number; indice: number }
/** destino puro: `tamanhos[c]` = nº de linhas (cards e faixas) da coluna c; colunas vazias são puladas na horizontal. */
export function proximaPosicao(p: Posicao, seta: Seta, tamanhos: readonly number[]): Posicao {
  const n = tamanhos.length;
  const tam = (c: number): number => tamanhos[c] ?? 0;
  if (seta === "ArrowUp") return { coluna: p.coluna, indice: Math.max(0, p.indice - 1) };
  if (seta === "ArrowDown") return { coluna: p.coluna, indice: Math.min(Math.max(0, tam(p.coluna) - 1), p.indice + 1) };
  if (seta === "Home") return { coluna: p.coluna, indice: 0 };
  if (seta === "End") return { coluna: p.coluna, indice: Math.max(0, tam(p.coluna) - 1) };
  const passo = seta === "ArrowLeft" ? -1 : 1;
  for (let c = p.coluna + passo; c >= 0 && c < n; c += passo) {
    if (tam(c) > 0) return { coluna: c, indice: Math.min(p.indice, tam(c) - 1) };
  }
  return p;
}

/** foca a linha `indice` da coluna (rolando a lista virtualizada se preciso). Devolve false se a coluna não existe. */
export function focarLinha(raiz: ParentNode, coluna: number, indice: number, alturaLinha: number): boolean {
  const lista = raiz.querySelector<HTMLElement>(`[data-coluna-idx="${coluna}"] [data-lista]`);
  if (lista === null) return false;
  const tentar = (): boolean => {
    const alvo = lista.querySelector<HTMLElement>(`[data-pos="${indice}"]`);
    if (alvo === null || alvo === undefined) return false;
    alvo.focus();
    return true;
  };
  if (tentar()) return true;
  lista.scrollTop = Math.max(0, indice * alturaLinha - lista.clientHeight / 2);
  lista.dispatchEvent(new Event("scroll"));
  setTimeout(tentar, 0);
  return true;
}
