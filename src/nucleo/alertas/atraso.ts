// Definição operacional de "atrasada" (T-20.06, D-151). PURO: sem banco, sem Electron, relógio por parâmetro.
//  1. estimativa: mediana por SP (>= minimo_amostras) -> tabela padrão -> mediana geral do workspace -> `sem_base`;
//  2. limite = max(estimativa x fator, estimativa + folga);
//  3. atrasada por esforço: tempo ATIVO > limite com a task em andamento; `em_risco` quando ativo >= estimativa;
//     escalonamento: 1º cruzamento `atrasada`, em 2 x limite `muito_atrasada` (no máximo 2 alertas por task);
//  4. atrasada por prazo da sprint: fim vencido e task não concluída;
//  5. não é atraso: aguardando, bloqueada, sem base.
import type { ConfigAlertas } from "../../compartilhado/alertas";
import { CONFIG_ALERTAS_PADRAO } from "../../compartilhado/alertas";

export type OrigemEstimativa = "mediana_sp" | "tabela" | "mediana_geral" | "sem_base";
export type EstadoTaskAtraso = "em_andamento" | "aguardando" | "bloqueada" | "concluida" | "outro";

export interface AmostraConcluida {
  workspace_id: string;
  story_points: number | null;
  tempo_trabalho_ms: number;
}

export interface TaskAtraso {
  task_id: string;
  workspace_id: string;
  story_points: number | null;
  /** tempo de trabalho acumulado (Pane `trabalhando`), em ms. */
  ativo_ms: number;
  estado: EstadoTaskAtraso;
  /** níveis já avisados por esforço: 0 | 1 | 2. */
  alertou_atraso: 0 | 1 | 2;
  /** fim da sprint ativa (ISO) ou `null`. */
  prazo_sprint?: string | null;
  alertou_prazo?: boolean;
}

export type VeredictoAtraso = "nao_aplica" | "sem_base" | "no_prazo" | "em_risco" | "atrasada" | "muito_atrasada";

export interface DecisaoAtraso {
  veredito: VeredictoAtraso;
  origem: OrigemEstimativa;
  estimativa_ms: number | null;
  limite_ms: number | null;
  ativo_ms: number;
  /** alerta a emitir agora (o chamador grava o novo `alertou_atraso`). */
  emitir: null | { tipo: "atrasada" | "muito_atrasada"; motivo: "esforco" | "prazo"; novo_nivel: 1 | 2 | null };
  atraso_ms: number | null;
}

const MIN = 60_000;

export function mediana(valores: number[]): number {
  const v = [...valores].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 === 1 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2;
}

function degrauDaTabela(sp: number, tabela: Record<string, number>): number | null {
  const degraus = Object.keys(tabela).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (degraus.length === 0) return null;
  const alvo = degraus.find((d) => d >= sp) ?? (degraus[degraus.length - 1] as number);
  return (tabela[String(alvo)] as number) * MIN;
}

export function estimar(task: Pick<TaskAtraso, "workspace_id" | "story_points">, historico: AmostraConcluida[], cfg: ConfigAlertas["atraso"] = CONFIG_ALERTAS_PADRAO.atraso): { estimativa_ms: number | null; origem: OrigemEstimativa } {
  const doWs = historico.filter((h) => h.workspace_id === task.workspace_id && Number.isFinite(h.tempo_trabalho_ms) && h.tempo_trabalho_ms >= 0);
  const sp = task.story_points;
  if (sp !== null && Number.isFinite(sp)) {
    const mesmas = doWs.filter((h) => h.story_points === sp);
    if (mesmas.length >= cfg.minimo_amostras) return { estimativa_ms: mediana(mesmas.map((h) => h.tempo_trabalho_ms)), origem: "mediana_sp" };
    const t = degrauDaTabela(sp, cfg.tabela_pontos_min);
    if (t !== null) return { estimativa_ms: t, origem: "tabela" };
  }
  if (doWs.length >= cfg.minimo_amostras) return { estimativa_ms: mediana(doWs.map((h) => h.tempo_trabalho_ms)), origem: "mediana_geral" };
  return { estimativa_ms: null, origem: "sem_base" };
}

export const limiteDe = (estimativa_ms: number, cfg: ConfigAlertas["atraso"] = CONFIG_ALERTAS_PADRAO.atraso): number => Math.max(estimativa_ms * cfg.fator, estimativa_ms + cfg.folga_min * MIN);

export function decidirAtraso(task: TaskAtraso, historico: AmostraConcluida[], cfg: ConfigAlertas["atraso"], agora: number): DecisaoAtraso {
  const base = estimar(task, historico, cfg);
  const limite = base.estimativa_ms === null ? null : limiteDe(base.estimativa_ms, cfg);
  const comum = { origem: base.origem, estimativa_ms: base.estimativa_ms, limite_ms: limite, ativo_ms: task.ativo_ms };
  if (task.estado !== "em_andamento") return { ...comum, veredito: "nao_aplica", emitir: null, atraso_ms: null };

  // prazo da sprint (independe de base de estimativa)
  const fim = task.prazo_sprint === undefined || task.prazo_sprint === null ? NaN : Date.parse(task.prazo_sprint);
  if (Number.isFinite(fim) && agora > fim) {
    return { ...comum, veredito: "atrasada", emitir: task.alertou_prazo === true ? null : { tipo: "atrasada", motivo: "prazo", novo_nivel: null }, atraso_ms: agora - fim };
  }
  if (limite === null || base.estimativa_ms === null) return { ...comum, veredito: "sem_base", emitir: null, atraso_ms: null };

  const ativo = task.ativo_ms;
  if (ativo >= limite * 2) {
    return { ...comum, veredito: "muito_atrasada", emitir: task.alertou_atraso >= 2 ? null : { tipo: "muito_atrasada", motivo: "esforco", novo_nivel: 2 }, atraso_ms: ativo - base.estimativa_ms };
  }
  if (ativo > limite) {
    return { ...comum, veredito: "atrasada", emitir: task.alertou_atraso >= 1 ? null : { tipo: "atrasada", motivo: "esforco", novo_nivel: 1 }, atraso_ms: ativo - base.estimativa_ms };
  }
  if (ativo >= base.estimativa_ms) return { ...comum, veredito: "em_risco", emitir: null, atraso_ms: null };
  return { ...comum, veredito: "no_prazo", emitir: null, atraso_ms: null };
}

/**
 * Instante (ms epoch) em que o PRÓXIMO alerta de esforço vence se a task continuar trabalhando a partir de `agora`.
 * `null`: nada a agendar (não está em andamento, sem base, ou os 2 alertas já saíram). O tempo só avança com o Pane
 * `trabalhando`, portanto o chamador recalcula quando o Pane volta a trabalhar (`restante = limite - ativo`).
 */
export function proximoVencimento(task: TaskAtraso, historico: AmostraConcluida[], cfg: ConfigAlertas["atraso"], agora: number): number | null {
  if (task.estado !== "em_andamento") return null;
  const candidatos: number[] = [];
  const fim = task.prazo_sprint === undefined || task.prazo_sprint === null ? NaN : Date.parse(task.prazo_sprint);
  if (Number.isFinite(fim) && task.alertou_prazo !== true) candidatos.push(Math.max(fim + 1, agora));
  const { estimativa_ms } = estimar(task, historico, cfg);
  if (estimativa_ms !== null && task.alertou_atraso < 2) {
    const limite = limiteDe(estimativa_ms, cfg);
    const alvo = task.alertou_atraso === 0 ? limite : limite * 2;
    candidatos.push(agora + Math.max(0, alvo - task.ativo_ms) + 1);
  }
  return candidatos.length === 0 ? null : Math.min(...candidatos);
}

export interface RiscoSprint {
  em_risco: boolean;
  restante_ms: number;
  capacidade_ms: number;
}
/** `sprint_em_risco` quando Σ estimativa restante > capacidade restante. Qualquer dado ausente => nunca afirma risco. */
export function sprintEmRisco(estimativaRestanteMs: number | null, capacidadeRestanteMs: number | null): RiscoSprint | null {
  if (estimativaRestanteMs === null || capacidadeRestanteMs === null) return null;
  return { em_risco: estimativaRestanteMs > capacidadeRestanteMs, restante_ms: estimativaRestanteMs, capacidade_ms: capacidadeRestanteMs };
}
