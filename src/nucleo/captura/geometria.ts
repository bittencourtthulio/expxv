// Geometria pura de captura (Fase 11, T-11.15): displays com fator de escala, recorte lógico -> físico. Sem Electron, sem I/O.
import { LIMITES_CAPTURA, type RetanguloLogico } from "../../compartilhado/captura";

export interface DisplayInfo {
  id: number;
  /** origem em coordenadas lógicas do desktop. */
  x: number;
  y: number;
  /** tamanho lógico. */
  largura: number;
  altura: number;
  /** fator de escala (1, 1,25, 1,5, 2…). */
  fator: number;
}

export interface Retangulo { x: number; y: number; largura: number; altura: number }

export function tamanhoFisico(d: Pick<DisplayInfo, "largura" | "altura" | "fator">): { largura: number; altura: number } {
  return { largura: Math.max(1, Math.round(d.largura * d.fator)), altura: Math.max(1, Math.round(d.altura * d.fator)) };
}

/** `thumbnailSize` do `desktopCapturer`: tamanho FÍSICO do display (senão a imagem sai em baixa resolução num Retina). */
export function tamanhoDaMiniatura(d: DisplayInfo): { width: number; height: number } {
  const t = tamanhoFisico(d);
  return { width: t.largura, height: t.altura };
}

function finito(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n);
}

/** a seleção lógica é utilizável? (números finitos, positiva e pelo menos `selecao_min_px` nos dois eixos). */
export function selecaoValida(r: RetanguloLogico): boolean {
  return finito(r.x) && finito(r.y) && finito(r.largura) && finito(r.altura) && r.largura >= LIMITES_CAPTURA.selecao_min_px && r.altura >= LIMITES_CAPTURA.selecao_min_px;
}

/** Recorte lógico (relativo ao display) -> físico (pixels do bitmap congelado), inteiro e dentro dos limites. `null` se fica vazio. */
export function recorteFisico(d: DisplayInfo, r: RetanguloLogico): Retangulo | null {
  if (!finito(r.x) || !finito(r.y) || !finito(r.largura) || !finito(r.altura) || r.largura <= 0 || r.altura <= 0) return null;
  const fis = tamanhoFisico(d);
  const x0 = Math.max(0, Math.min(fis.largura, Math.round(r.x * d.fator)));
  const y0 = Math.max(0, Math.min(fis.altura, Math.round(r.y * d.fator)));
  const x1 = Math.max(0, Math.min(fis.largura, Math.round((r.x + r.largura) * d.fator)));
  const y1 = Math.max(0, Math.min(fis.altura, Math.round((r.y + r.altura) * d.fator)));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, largura: x1 - x0, altura: y1 - y0 };
}

/** Dois cantos quaisquer (arrasto em qualquer direção) -> retângulo normalizado. */
export function retanguloDeCantos(a: { x: number; y: number }, b: { x: number; y: number }): RetanguloLogico {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), largura: Math.abs(a.x - b.x), altura: Math.abs(a.y - b.y) };
}

/** Display que contém o ponto (coordenadas lógicas do desktop); sem acerto, o mais próximo; sem displays, `null`. */
export function displayDoPonto(displays: readonly DisplayInfo[], p: { x: number; y: number }): DisplayInfo | null {
  let melhor: DisplayInfo | null = null;
  let menor = Infinity;
  for (const d of displays) {
    const dx = p.x < d.x ? d.x - p.x : p.x > d.x + d.largura ? p.x - (d.x + d.largura) : 0;
    const dy = p.y < d.y ? d.y - p.y : p.y > d.y + d.altura ? p.y - (d.y + d.altura) : 0;
    const dist = dx * dx + dy * dy;
    if (dist < menor) { menor = dist; melhor = d; }
  }
  return melhor;
}

/** Display onde está a maior parte de uma janela (bounds lógicos do desktop). */
export function displayDaJanela(displays: readonly DisplayInfo[], janela: Retangulo): DisplayInfo | null {
  let melhor: DisplayInfo | null = null;
  let maior = -1;
  for (const d of displays) {
    const w = Math.max(0, Math.min(d.x + d.largura, janela.x + janela.largura) - Math.max(d.x, janela.x));
    const h = Math.max(0, Math.min(d.y + d.altura, janela.y + janela.altura) - Math.max(d.y, janela.y));
    if (w * h > maior) { maior = w * h; melhor = d; }
  }
  return maior > 0 ? melhor : displayDoPonto(displays, { x: janela.x + janela.largura / 2, y: janela.y + janela.altura / 2 });
}
