// Valores ESPERADOS da fixture (gerar.ts), calculados À MÃO e escritos como literais/aritmética direta (NÃO chamam o código sob teste).
// Construção: sprint n (1..40), 4 tasks (T1..T4) de 3, 5, 2 e 8 pontos; T4 só é concluída quando n não é múltiplo de 4.
// Duração observada: T1 2 h, T2 4 h, T3 1 h, T4 6 h. Retrabalho: T2 (QA alta) em n%5==0; T1 (reaberta) em n%10==0; T3 (commit fix) em n%7==0.
// Escopo (não é defeito): commit feat após concluir T1 em n%9==0. Bug escapado: n%8==0.
import { HORA } from "./util-horas";

/** tasks concluídas por task: T1..T3 em todas as 40 sprints; T4 em 30 (10 sprints múltiplas de 4 ficam sem T4). */
export const CONCLUIDAS_POR_TASK = [40, 40, 40, 30] as const;
export const CONCLUIDAS_TOTAL = 150; // 40 + 40 + 40 + 30

/** velocidade (pontos) da sprint n: 18 = 3+5+2+8; nas múltiplas de 4 falta a task de 8 pontos => 10. */
export const velocidadeEsperada = (n: number): number => (n % 4 === 0 ? 10 : 18);

/** cycle time: 150 amostras (40×1 h, 40×2 h, 40×4 h, 30×6 h). Interpolação linear: P50 pos 74,5 (2 h), P85 pos 126,65 (6 h), P95 pos 141,55 (6 h). */
export const CYCLE = { n: 150, p50: 2 * HORA, p85: 6 * HORA, p95: 6 * HORA } as const;

/** retrabalho: T2 8 sprints (5,10,...,40) + T1 4 sprints (10,20,30,40) + T3 5 sprints (7,14,21,28,35) = 17 tasks em 150 avaliáveis. */
export const RETRABALHO = {
  tasks_retrabalho: 17,
  avaliaveis: 150,
  ir: 0.1133, // 17/150
  first_time_right: 0.8867, // 1 - 17/150
  em_observacao: 0,
  indeterminado: 0,
  escopo_eventos: 4, // n = 9, 18, 27, 36
  pontos_retrabalhados: 62, // 4×3 (T1) + 8×5 (T2) + 5×2 (T3)
  horas_observadas_retrabalho_min: 8, // 4 reaberturas de T1 × 2 h
} as const;

/** FTR por sprint (concluídas e retrabalho): 1 => 4 tasks, 0 retrabalho; 5 => 4, T2; 7 => 4, T3; 10 => 4, T1+T2; 20 => 3 (sem T4), T1+T2. */
export const IR_SPRINT: Record<number, number> = { 1: 0, 5: 0.25, 7: 0.25, 10: 0.5, 20: 2 / 3 };

/** erro de estimativa. Feature = T1, T2, T4 (110 amostras): ms/ponto = 40×(2/3 h), 30×(0,75 h), 40×(0,8 h) => mediana 0,75 h/ponto.
 *  razões: T1 2/(3×0,75)=0,8889; T2 4/(5×0,75)=1,0667; T4 6/(8×0,75)=1 => viés (mediana) 1; MdAPE (mediana de |r-1|) = 0,0667. Bug = T3: ref 0,5 h/ponto, razão 1. */
export const ERRO_ESTIMATIVA = { feature: { n: 110, vies: 1, mdape: 0.0667 }, bug: { n: 40, vies: 1, mdape: 0 } } as const;

/** XP: tdd_primeiro (T1 e T3 testes primeiro) = 80/150; vermelho antes do verde (só T1) = 40/150; commit por task = 150/150. */
export const XP = { tdd_primeiro: 0.5333, vermelho_antes_do_verde: 0.2667, commit_por_task: 1, commits_pequenos_mediana: 120 } as const;

/** burndown da sprint 1 (2026-01-05 seg .. 2026-01-16 sex; 10 dias úteis; compromisso 18). concluído: 06->3, 08->8, 09->10, 13->18. ideal = 18×(1−k/10). */
export const BURNDOWN_SPRINT_1: { dia: string; concluido: number; restante: number; ideal: number }[] = [
  { dia: "2026-01-05", concluido: 0, restante: 18, ideal: 16.2 },
  { dia: "2026-01-06", concluido: 3, restante: 15, ideal: 14.4 },
  { dia: "2026-01-07", concluido: 3, restante: 15, ideal: 12.6 },
  { dia: "2026-01-08", concluido: 8, restante: 10, ideal: 10.8 },
  { dia: "2026-01-09", concluido: 10, restante: 8, ideal: 9 },
  { dia: "2026-01-10", concluido: 10, restante: 8, ideal: 9 },
  { dia: "2026-01-11", concluido: 10, restante: 8, ideal: 9 },
  { dia: "2026-01-12", concluido: 10, restante: 8, ideal: 7.2 },
  { dia: "2026-01-13", concluido: 18, restante: 0, ideal: 5.4 },
  { dia: "2026-01-14", concluido: 18, restante: 0, ideal: 3.6 },
  { dia: "2026-01-15", concluido: 18, restante: 0, ideal: 1.8 },
  { dia: "2026-01-16", concluido: 18, restante: 0, ideal: 0 },
];

/** throughput da sprint 1: uma task concluída em 06, 08, 09 e 13 de janeiro. */
export const THROUGHPUT_SPRINT_1: Record<string, number> = { "2026-01-06": 1, "2026-01-08": 1, "2026-01-09": 1, "2026-01-13": 1 };

/** planejado × entregue da sprint 4 (múltipla de 4): compromisso 18, entregue 10, carregado 8, nada adicionado no meio. */
export const PLANEJADO_SPRINT_4 = { compromisso_inicial: 18, entregue_do_compromisso: 10, adicionado_meio: 0, carregado: 8, removido: 0 } as const;

/** defeitos escapados: bug aberto 3 dias após o fechamento das sprints 8, 16, 24, 32, 40 (categoria `api`). */
export const DEFEITOS_ESCAPADOS = { total: 5, sprints: [8, 16, 24, 32, 40], categoria: "api" } as const;
