import { ponte } from "./ponte";

/** Marca no renderer (performance.mark) e envia ao main quando a API existe. */
export function marcar(nome: string): void {
  try {
    performance.mark(nome);
  } catch {
    /* ambiente sem Performance API */
  }
  ponte()?.perf.marcar(nome);
}
