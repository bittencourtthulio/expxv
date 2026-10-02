import type { GrafoMemoria } from "./memoria";

export interface MetricasNo {
  /** Fan-in (Ca): quantos nós dependem deste. */
  ca: number;
  /** Fan-out (Ce): de quantos este depende. */
  ce: number;
  /** I = Ce / (Ca + Ce); 0 quando isolado. */
  instabilidade: number;
}

export function metricasDoNo(g: GrafoMemoria, i: number): MetricasNo {
  const ca = g.grauEntrada(i);
  const ce = g.grauSaida(i);
  return { ca, ce, instabilidade: ca + ce === 0 ? 0 : ce / (ca + ce) };
}

export function metricasDoGrafo(g: GrafoMemoria): MetricasNo[] {
  return Array.from({ length: g.n }, (_, i) => metricasDoNo(g, i));
}
