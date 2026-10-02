// Pré-carrega o chunk da tela Pipelines em ocioso, depois da primeira pintura (P-215: abrir ≤ 50 ms). Nunca no JS inicial; sem rede.
type Ocioso = (cb: () => void, opcoes?: { timeout: number }) => number;
let carregando: Promise<unknown> | null = null;

export function precarregarPipelines(): Promise<unknown> {
  carregando ??= import("../telas/pipelines").catch(() => { carregando = null; });
  return carregando;
}
export function agendarPrecargaPipelines(alvo: { requestIdleCallback?: Ocioso; cancelIdleCallback?: (id: number) => void } = globalThis as never): () => void {
  if (typeof alvo.requestIdleCallback === "function") {
    const id = alvo.requestIdleCallback(() => void precarregarPipelines(), { timeout: 4000 });
    return () => alvo.cancelIdleCallback?.(id);
  }
  const t = setTimeout(() => void precarregarPipelines(), 1500);
  return () => clearTimeout(t);
}
