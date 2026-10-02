// T-18.31: previsão de término por Monte Carlo (bootstrap do throughput diário em dias úteis). SEMPRE em faixa P50/P85/P95 (nunca data única).
// Requer >= 10 dias e >= 5 conclusões na amostra; senão `dados_insuficientes`. Semente fixa => resultado reproduzível. Roda em worker no app (P-187).
import type { ConfigAgil, PrevisaoEstado } from "../../../compartilhado/agil";
import { ehDiaUtil, percentilOrdenado, prng, somarDias } from "../util";

export interface EntradaPrevisao {
  /** throughput de cada DIA ÚTIL observado (itens, ou pontos). */
  amostra: readonly number[];
  restante: number;
  iteracoes: number;
  semente: number;
  /** dias úteis que faltam até o fim da sprint (para a probabilidade de fechar); null sem sprint. */
  dias_uteis_restantes: number | null;
  hoje: string;
  config: Pick<ConfigAgil, "dias_uteis" | "feriados">;
  min_dias?: number;
  min_conclusoes?: number;
}
const TETO_DIAS = 2000;

function somarDiasUteis(inicio: string, n: number, c: Pick<ConfigAgil, "dias_uteis" | "feriados">): string {
  let d = inicio;
  let k = 0;
  for (let guard = 0; k < n && guard < 8000; guard++) { d = somarDias(d, 1); if (ehDiaUtil(d, c)) k++; }
  return d;
}

export function preverTermino(e: EntradaPrevisao): PrevisaoEstado {
  const amostra = e.amostra;
  const conclusoes = amostra.reduce((a, b) => a + b, 0);
  if (amostra.length < (e.min_dias ?? 10) || conclusoes < (e.min_conclusoes ?? 5)) return { estado: "dados_insuficientes" };
  if (e.restante <= 0) return { estado: "ok", iteracoes: 0, p50_dias: 0, p85_dias: 0, p95_dias: 0, p50_data: e.hoje, p85_data: e.hoje, p95_data: e.hoje, prob_fechar_na_sprint: e.dias_uteis_restantes === null ? null : 1, restante: 0, amostra_dias: amostra.length };
  const rand = prng(e.semente);
  const n = amostra.length;
  const dias = new Float64Array(e.iteracoes);
  let dentro = 0;
  for (let it = 0; it < e.iteracoes; it++) {
    let acc = 0; let d = 0;
    while (acc < e.restante && d < TETO_DIAS) { acc += amostra[Math.floor(rand() * n)] as number; d++; }
    dias[it] = d;
    if (e.dias_uteis_restantes !== null && d <= e.dias_uteis_restantes) dentro++;
  }
  const ord = Array.from(dias).sort((a, b) => a - b);
  const p = (x: number): number => Math.ceil(percentilOrdenado(ord, x) as number);
  const [d50, d85, d95] = [p(50), p(85), p(95)] as [number, number, number];
  return {
    estado: "ok", iteracoes: e.iteracoes, p50_dias: d50, p85_dias: d85, p95_dias: d95,
    p50_data: somarDiasUteis(e.hoje, d50, e.config), p85_data: somarDiasUteis(e.hoje, d85, e.config), p95_data: somarDiasUteis(e.hoje, d95, e.config),
    prob_fechar_na_sprint: e.dias_uteis_restantes === null ? null : dentro / e.iteracoes, restante: e.restante, amostra_dias: n,
  };
}

/** amostra de throughput só de dias úteis (dias de fim de semana/feriado não puxam a média para baixo). */
export function amostraDiasUteis(serie: readonly { dia: string; valor: number }[], c: Pick<ConfigAgil, "dias_uteis" | "feriados">): number[] {
  return serie.filter((d) => ehDiaUtil(d.dia, c)).map((d) => d.valor);
}
