// Uso de CPU por delta de `os.cpus()` (total e por núcleo). Puro: recebe os contadores, devolve inteiros 0–100.
export interface TemposNucleo { ocioso: number; total: number }
export interface UsoCpu { total: number; nucleos: number[] }

interface CpuDoSo { times: { user: number; nice: number; sys: number; idle: number; irq: number } }

/** Reduz `os.cpus()` ao que importa (ocioso e total acumulados, em ms de CPU). */
export function temposDe(cpus: ReadonlyArray<CpuDoSo>): TemposNucleo[] {
  return cpus.map((c) => ({ ocioso: c.times.idle, total: c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq }));
}

const limitar = (v: number): number => (v <= 0 ? 0 : v >= 100 ? 100 : Math.round(v));

/**
 * Delta entre duas leituras. A PRIMEIRA amostra (sem leitura anterior) e uma mudança no número de núcleos devolvem `null`
 * (não há como medir); contador que recuou (wrap/reinício) vale 0 naquele núcleo e não entra no total.
 */
export function usoCpu(anterior: readonly TemposNucleo[] | null, atual: readonly TemposNucleo[]): UsoCpu | null {
  if (anterior === null || anterior.length === 0 || anterior.length !== atual.length) return null;
  let somaTotal = 0;
  let somaUsado = 0;
  const nucleos = atual.map((a, i) => {
    const p = anterior[i]!;
    const dTotal = a.total - p.total;
    const dOcioso = a.ocioso - p.ocioso;
    if (dTotal <= 0 || dOcioso < 0 || dOcioso > dTotal) return 0;
    somaTotal += dTotal;
    somaUsado += dTotal - dOcioso;
    return limitar(((dTotal - dOcioso) / dTotal) * 100);
  });
  return { total: somaTotal === 0 ? 0 : limitar((somaUsado / somaTotal) * 100), nucleos };
}
