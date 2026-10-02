// Atribuição de achado de QA a task: (1) task citada; (2) interseção de arquivos (as tasks com MAIOR interseção); (3) só o trabalho.
import type { AchadoQa } from "../portas";

export interface TaskArquivos { task_ref: string; arquivos: readonly string[] }

export function atribuirAchado(a: AchadoQa, tasks: readonly TaskArquivos[]): { tasks: string[]; metodo: "citada" | "arquivos" | "trabalho" } {
  if (a.task) {
    const citada = tasks.find((t) => t.task_ref.toLowerCase() === a.task?.toLowerCase());
    if (citada) return { tasks: [citada.task_ref], metodo: "citada" };
  }
  const alvo = new Set(a.arquivos);
  let melhor = 0;
  let escolhidas: string[] = [];
  for (const t of tasks) {
    let n = 0;
    for (const f of t.arquivos) if (alvo.has(f)) n++;
    if (n === 0) continue;
    if (n > melhor) { melhor = n; escolhidas = [t.task_ref]; } else if (n === melhor) escolhidas.push(t.task_ref);
  }
  return escolhidas.length > 0 ? { tasks: escolhidas, metodo: "arquivos" } : { tasks: [], metodo: "trabalho" };
}

export const severidadeForte = (s: string): boolean => s === "alta" || s === "media";
