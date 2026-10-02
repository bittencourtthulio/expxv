// Geometria PURA do passeio (D-651): chão virtual, cantos, lugares de sono e sorteio determinístico. Os retângulos vêm de UMA leitura de
// `getBoundingClientRect` por passeio (nunca por quadro); aqui só há conta.
export interface Retangulo { left: number; top: number; right: number; bottom: number }
export interface Area {
  largura: number;
  altura: number;
  /** y dos pés quando o bichinho está "no chão": a borda de cima do rodapé. */
  chao: number;
}
export interface Lugar { id: string; /** x do CENTRO do bichinho */ x: number; /** y dos PÉS */ y: number }
export interface Ambiente {
  area: Area;
  /** retângulo do painel de workspaces aberto, se houver. */
  painel: Retangulo | null;
  /** bordas de cima de até 3 cartões visíveis. */
  cartoes: readonly Retangulo[];
  /** barra do topo (para pendurar no canto superior). */
  topo: Retangulo | null;
}

export const MARGEM_CANTO = 10;
/** Os pés do desenho ficam um pouco abaixo da base da caixa. */
export const AFUNDO_PX = 4;

export const chaoDe = (altura: number, alturaRodape: number): number => Math.max(0, altura - alturaRodape);

/** Mantém o centro `x` com o bichinho inteiro dentro da janela. */
export const limitarX = (x: number, area: Pick<Area, "largura">, tam: number): number => Math.min(Math.max(x, tam / 2 + MARGEM_CANTO), Math.max(tam / 2 + MARGEM_CANTO, area.largura - tam / 2 - MARGEM_CANTO));

/** Ponto do chão a partir de um sorteio u∈[0,1): ocupa a janela inteira, de canto a canto. */
export const pontoNoChao = (area: Area, tam: number, u: number): Lugar => ({ id: "chao", x: limitarX(tam / 2 + MARGEM_CANTO + u * (area.largura - tam - 2 * MARGEM_CANTO), area, tam), y: area.chao });

/** Canto superior esquerdo da caixa de um bichinho de tamanho `tam` cujos pés estão em `lugar`. */
export const caixaNoLugar = (l: Pick<Lugar, "x" | "y">, tam: number): { x: number; y: number } => ({ x: l.x - tam / 2, y: l.y - tam + AFUNDO_PX });

/** Lugares onde dá para deitar: cantos do chão, sobre o rodapé, ao lado do painel, no topo de cartões e pendurado sob a barra do topo. Ordem estável. */
export function lugaresDeSono(amb: Ambiente, tam: number): Lugar[] {
  const { area } = amb;
  const out: Lugar[] = [
    { id: "canto_esquerdo", x: limitarX(0, area, tam), y: area.chao },
    { id: "canto_direito", x: limitarX(area.largura, area, tam), y: area.chao },
    { id: "sobre_rodape", x: limitarX(area.largura * 0.5, area, tam), y: area.chao },
    { id: "rodape_esquerda", x: limitarX(area.largura * 0.28, area, tam), y: area.chao },
    { id: "rodape_direita", x: limitarX(area.largura * 0.72, area, tam), y: area.chao },
  ];
  if (amb.painel !== null) out.push({ id: "lado_do_painel", x: limitarX(amb.painel.right + tam * 0.7, area, tam), y: area.chao });
  amb.cartoes.slice(0, 3).forEach((c, i) => {
    if (c.top > tam && c.right > c.left) out.push({ id: `cartao_${i}`, x: limitarX((c.left + c.right) / 2, area, tam), y: c.top });
  });
  if (amb.topo !== null) out.push({ id: "sob_o_topo", x: limitarX(area.largura * 0.82, area, tam), y: amb.topo.bottom + tam - AFUNDO_PX });
  return out;
}

/** FNV-1a de 32 bits: semente estável a partir de texto (id do workspace). */
export function hash32(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** mulberry32: sorteio determinístico em [0,1) a partir de uma semente. */
export function criarSorteio(semente: number): () => number {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Escolha determinística do lugar de dormir (semente do workspace + ciclo): vai ao primeiro livre a partir do índice sorteado, então dois bichinhos nunca dormem no mesmo ponto. */
export function escolherLugar(lugares: readonly Lugar[], semente: number, ocupados: ReadonlySet<string>): Lugar | null {
  if (lugares.length === 0) return null;
  const inicio = semente % lugares.length;
  for (let i = 0; i < lugares.length; i++) {
    const l = lugares[(inicio + i) % lugares.length]!;
    if (!ocupados.has(l.id)) return l;
  }
  return lugares[inicio]!;
}

/** Tempo de um trecho: distância ÷ velocidade, entre o mínimo e o máximo (o CSS usa o mesmo número na transição). */
export const duracaoDoTrecho = (distanciaPx: number, pxPorSegundo: number, minimoMs: number, maximoMs: number): number => Math.round(Math.min(maximoMs, Math.max(minimoMs, (distanciaPx / pxPorSegundo) * 1000)));
export const distancia = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Posições da "parada" (segredo): fila no centro da janela, espaçada pelo tamanho. */
export function posicaoDaParada(area: Area, tam: number, indice: number, total: number): Lugar {
  const passo = tam * 1.15;
  const x0 = area.largura / 2 - ((total - 1) * passo) / 2;
  return { id: `parada_${indice}`, x: limitarX(x0 + indice * passo, area, tam), y: area.chao };
}

/** Ponto do retângulo `r` contido em `limite`: usado para soltar o elemento carregado dentro do que o recorta. */
export function prenderRetangulo(r: Retangulo, dx: number, dy: number, limite: Retangulo, folga = 2): { dx: number; dy: number } {
  const minDx = limite.left + folga - r.left;
  const maxDx = limite.right - folga - r.right;
  const minDy = limite.top + folga - r.top;
  const maxDy = limite.bottom - folga - r.bottom;
  return { dx: minDx > maxDx ? 0 : Math.min(Math.max(dx, minDx), maxDx), dy: minDy > maxDy ? 0 : Math.min(Math.max(dy, minDy), maxDy) };
}
