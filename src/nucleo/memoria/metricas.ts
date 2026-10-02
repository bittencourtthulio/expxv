// Observabilidade sem vazar conteúdo (T-08.20): só contadores e tamanhos. Nada de `conteudo`, nada de segredo.
export interface Metricas {
  contar(nome: string, valor?: number): void;
  /** instantâneo copiável para o diagnóstico do app (metadados apenas). */
  instantaneo(): Record<string, number>;
}

export function criarMetricas(): Metricas {
  const c = new Map<string, number>();
  return {
    contar(nome, valor = 1) {
      if (!/^[a-z0-9_.]{1,60}$/.test(nome)) return; // nome livre nunca entra (evita vazar texto por engano)
      c.set(nome, (c.get(nome) ?? 0) + valor);
    },
    instantaneo: () => Object.fromEntries([...c.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

export const metricasNulas: Metricas = { contar: () => undefined, instantaneo: () => ({}) };
