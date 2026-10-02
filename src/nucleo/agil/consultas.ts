// Consultas prontas (lado do núcleo) para a tela de backlog e para as tools MCP de leitura. Tudo derivado; nada escreve.
import type { FiltrosBacklog, IndicadorSaude, ItemResumo, PainelAgil } from "../../compartilhado/agil";
import { wsjf } from "./backlog/priorizar";
import type { BancoAgil } from "./repos";
import { montarItensMetrica, type ItemMetrica } from "./metricas/dados";
import { normalizar } from "./util";

export const FILTROS_BACKLOG_VAZIOS: FiltrosBacklog = { texto: null, epico_id: null, estado_fluxo: null, categoria: null, risco: null, criticidade: null, sprint_id: null, sem_estimativa: null };

export interface PaginaBacklog { itens: ItemResumo[]; proximo: string | null; total: number; contagens: Record<string, number> }

export function listarBacklog(banco: BancoAgil, ws: string, f: FiltrosBacklog = FILTROS_BACKLOG_VAZIOS, ordenar: "ordem" | "wsjf" = "ordem", cursor: string | null = null, limite = 100): PaginaBacklog {
  const base = new Map(banco.itens.valores().map((i) => [i.id, i]));
  const membros = new Map(banco.membros.valores().map((m) => [m.id, m.rotulo]));
  const estim = new Map(banco.estimativas.valores().filter((e) => e.ativa).map((e) => [e.item_id, e]));
  const texto = f.texto ? normalizar(f.texto) : null;
  const resumos: ItemResumo[] = [];
  const contagens: Record<string, number> = {};
  for (const m of montarItensMetrica(banco, ws)) {
    const it = base.get(m.item_id);
    if (!it || m.descartado) continue;
    const sprint = m.participacoes.filter((p) => !p.removido_em).map((p) => p.sprint_id)[0] ?? null;
    const r: ItemResumo = {
      id: m.item_id, origem: m.origem, trabalho_id: m.trabalho_id, task_ref: m.task_ref, titulo: m.titulo, epico_id: it.epico_id, estado_ade: it.estado_ade, estado_fluxo: m.estado_fluxo,
      pontos: m.pontos, categoria: m.categoria, risco: m.risco, criticidade: m.criticidade, ordem: it.ordem, wsjf: wsjf(it, m.pontos), situacao_retrabalho: m.situacao, duracao_obs_ms: m.duracao_obs_ms,
      sprint_id: sprint, dono: m.membro_id ? membros.get(m.membro_id) ?? m.membro_id : null, estimativa_origem: m.estimativa_origem, estimativa_confianca: estim.get(m.item_id)?.confianca ?? null,
    };
    contagens[r.estado_fluxo] = (contagens[r.estado_fluxo] ?? 0) + 1;
    if (texto && !normalizar(r.titulo).includes(texto)) continue;
    if (f.epico_id && r.epico_id !== f.epico_id) continue;
    if (f.estado_fluxo && r.estado_fluxo !== f.estado_fluxo) continue;
    if (f.categoria && r.categoria !== f.categoria) continue;
    if (f.risco && r.risco !== f.risco) continue;
    if (f.criticidade && r.criticidade !== f.criticidade) continue;
    if (f.sprint_id && r.sprint_id !== f.sprint_id) continue;
    if (f.sem_estimativa !== null && (r.pontos === null) !== f.sem_estimativa) continue;
    resumos.push(r);
  }
  const cmp = ordenar === "wsjf" ? (a: ItemResumo, b: ItemResumo): number => (b.wsjf ?? -Infinity) - (a.wsjf ?? -Infinity) || a.ordem - b.ordem || a.id.localeCompare(b.id) : (a: ItemResumo, b: ItemResumo): number => a.ordem - b.ordem || a.id.localeCompare(b.id);
  resumos.sort(cmp);
  const ini = cursor ? Math.max(0, Number(cursor)) || 0 : 0;
  const fim = ini + Math.min(200, Math.max(1, limite));
  return { itens: resumos.slice(ini, fim), proximo: fim < resumos.length ? String(fim) : null, total: resumos.length, contagens };
}

export interface StatusSprint { sprint_id: string; nome: string; estado: string; committed: number | null; done: number; remaining: number | null; health: IndicadorSaude[] }
/** `sprint_status` (MCP, só leitura) a partir de um painel já calculado. */
export function statusDaSprint(p: PainelAgil, nome: string, sprintId: string, estado: string): StatusSprint {
  const ult = p.burndown ? [...p.burndown.dias].reverse().find((d) => d.concluido !== null) : undefined;
  return { sprint_id: sprintId, nome, estado, committed: p.burndown?.compromisso_inicial ?? null, done: ult?.concluido ?? 0, remaining: ult?.restante ?? null, health: p.saude };
}

export const METRICAS_NOMEADAS = ["burndown", "burnup", "velocity", "cfd", "cycle_time", "lead_time", "throughput", "wip", "rework", "planned_vs_delivered", "escaped_defects", "distribution", "forecast", "health", "estimate_error", "value_effort"] as const;
export type MetricaNomeada = (typeof METRICAS_NOMEADAS)[number];
/** `metrics_get` (MCP, só leitura): devolve a série numérica de uma métrica do painel. */
export function metricaPorNome(p: PainelAgil, metrica: MetricaNomeada): unknown {
  switch (metrica) {
    case "burndown": return p.burndown; case "burnup": return p.burnup; case "velocity": return p.velocidade; case "cfd": return p.cfd; case "cycle_time": return p.cycle; case "lead_time": return p.lead;
    case "throughput": return p.throughput; case "wip": return p.wip; case "rework": return p.retrabalho; case "planned_vs_delivered": return p.planejado_entregue; case "escaped_defects": return p.defeitos_escapados;
    case "distribution": return p.distribuicao; case "forecast": return p.previsao; case "health": return p.saude; case "estimate_error": return p.erro_estimativa; case "value_effort": return p.valor_esforco;
  }
}
export type { ItemMetrica };

export interface LinhaRetrabalhoMcp { task_ref: string | null; trabalho_id: string; fonte: string; forca: string; natureza: string; ocorrido_em: string | null; ativo: boolean; confirmado_por: string | null; evidencia: Record<string, unknown> }
/** `rework_list` (MCP, SOMENTE LEITURA, sem conteúdo de código): eventos e situação por task. A evidência já vem truncada (<= 160 caracteres) pelos detectores. */
export function listarRetrabalho(banco: BancoAgil, ws: string, limite = 100): { eventos: LinhaRetrabalhoMcp[]; situacoes: { trabalho_id: string; task_ref: string; situacao: string | null }[] } {
  const eventos = banco.eventosRetrabalho.valores().filter((e) => e.workspace_id === ws).sort((a, b) => (b.ocorrido_em ?? b.detectado_em).localeCompare(a.ocorrido_em ?? a.detectado_em) || a.id.localeCompare(b.id)).slice(0, Math.min(100, Math.max(1, limite)));
  return {
    eventos: eventos.map((e) => ({ task_ref: e.task_ref, trabalho_id: e.trabalho_id, fonte: e.fonte, forca: e.forca, natureza: e.natureza, ocorrido_em: e.ocorrido_em, ativo: e.ativo, confirmado_por: e.confirmado_por, evidencia: e.evidencia })),
    situacoes: banco.retrabalhoTasks.valores().filter((t) => t.workspace_id === ws && t.situacao !== null).map((t) => ({ trabalho_id: t.trabalho_id, task_ref: t.task_ref, situacao: t.situacao })),
  };
}
