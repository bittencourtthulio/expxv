/** Lógica pura da sub-navegação lateral (sem React): teclado e agrupamento. */

export interface ItemSubNav<T extends string = string> {
  id: T;
  rotulo: string;
  icone?: import("./Icone").NomeIcone;
  /** Selo/contagem opcional (ex.: pendências). */
  selo?: number | string;
  /** Título da seção em que o item aparece (itens consecutivos com o mesmo grupo formam uma seção). */
  grupo?: string;
  /** Texto de ajuda (title). */
  dica?: string;
}

export interface SecaoSubNav<T extends string = string> {
  titulo: string | null;
  itens: Array<{ item: ItemSubNav<T>; indice: number }>;
}

/** Índice de destino para a tecla (↑/↓ e ←/→ circulam; Home/End vão às pontas); -1 quando a tecla não navega. */
export function indiceDaTecla(tecla: string, atual: number, total: number): number {
  if (total <= 0) return -1;
  switch (tecla) {
    case "ArrowDown": case "ArrowRight": return (atual + 1) % total;
    case "ArrowUp": case "ArrowLeft": return (atual - 1 + total) % total;
    case "Home": return 0;
    case "End": return total - 1;
    default: return -1;
  }
}

/** Agrupa itens consecutivos pelo título de grupo, preservando a ordem e o índice global (para o teclado). */
export function agruparItens<T extends string>(itens: readonly ItemSubNav<T>[]): SecaoSubNav<T>[] {
  const secoes: SecaoSubNav<T>[] = [];
  itens.forEach((item, indice) => {
    const titulo = item.grupo ?? null;
    const ultima = secoes[secoes.length - 1];
    if (ultima !== undefined && ultima.titulo === titulo) ultima.itens.push({ item, indice });
    else secoes.push({ titulo, itens: [{ item, indice }] });
  });
  return secoes;
}

/** Inicial para o item sem ícone quando a barra está só com ícones. */
export const inicialDoRotulo = (rotulo: string): string => rotulo.trim().charAt(0).toUpperCase();
