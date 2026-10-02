// Atribuição de uso por janela (T-10.08, D-106). PURO. Atribuição CONSERVADORA: uso que não se prova de um card vai para `sem_card`; janelas de cards diferentes
// que se sobrepõem no mesmo Pane ⇒ `ambigua`; o piloto (orquestrador) é custo da Missão (`orquestracao`), nunca de card.
import type { Atribuicao } from "../../compartilhado/custo";

export interface JanelaTask {
  trabalho_id: string;
  task_id: string;
  inicio: string;
  /** `null` = em andamento. */
  fim: string | null;
}
export interface PaneParaAtribuicao {
  papel: string;
  workspace_id?: string | null;
}
export interface ResultadoAtribuicao {
  atribuicao: Atribuicao;
  trabalho_id: string | null;
  task_id: string | null;
}
/** Tolerância no FIM da janela: a mensagem final do handoff chega depois do `entregue`. */
export const TOLERANCIA_FIM_MS = 5000;

export const chaveCard = (workspace: string, trabalho: string, task: string): string => `${workspace}|${trabalho}|${task}`;

const ms = (iso: string): number => Date.parse(iso);

export function atribuir(ts: string, janelas: readonly JanelaTask[], pane: PaneParaAtribuicao, toleranciaMs: number = TOLERANCIA_FIM_MS): ResultadoAtribuicao {
  if (pane.papel === "piloto") return { atribuicao: "orquestracao", trabalho_id: null, task_id: null };
  const t = ms(ts);
  if (Number.isNaN(t)) return { atribuicao: "sem_card", trabalho_id: null, task_id: null };
  const estritas = new Map<string, JanelaTask>();
  const tolerantes = new Map<string, JanelaTask>();
  for (const j of janelas) {
    const ini = ms(j.inicio);
    if (Number.isNaN(ini) || t < ini) continue;
    const k = `${j.trabalho_id}|${j.task_id}`;
    if (j.fim === null) {
      estritas.set(k, j);
      continue;
    }
    const fim = ms(j.fim);
    if (Number.isNaN(fim)) continue;
    if (t <= fim) estritas.set(k, j);
    else if (t <= fim + toleranciaMs) tolerantes.set(k, j);
  }
  // a tolerância só vale quando nenhuma janela aberta/estrita contém o instante (evita falsa ambiguidade entre cards sequenciais)
  const usadas = estritas.size > 0 ? estritas : tolerantes;
  if (usadas.size === 0) return { atribuicao: "sem_card", trabalho_id: null, task_id: null };
  if (usadas.size > 1) return { atribuicao: "ambigua", trabalho_id: null, task_id: null };
  const j = [...usadas.values()][0] as JanelaTask;
  return { atribuicao: "card", trabalho_id: j.trabalho_id, task_id: j.task_id };
}

export interface RegistroParaReatribuir {
  id: string;
  ts: string;
  atribuicao: Atribuicao;
  trabalho_id: string | null;
  task_id: string | null;
}
export interface MudancaAtribuicao {
  id: string;
  de: ResultadoAtribuicao;
  para: ResultadoAtribuicao;
}
/** Recalcula a atribuição dos registros de um Pane e devolve SÓ o que mudou. Idempotente: rodar de novo com as mesmas janelas devolve `[]`. */
export function reatribuir(registros: readonly RegistroParaReatribuir[], janelas: readonly JanelaTask[], pane: PaneParaAtribuicao, toleranciaMs: number = TOLERANCIA_FIM_MS): MudancaAtribuicao[] {
  const saida: MudancaAtribuicao[] = [];
  for (const r of registros) {
    const para = atribuir(r.ts, janelas, pane, toleranciaMs);
    if (para.atribuicao !== r.atribuicao || para.trabalho_id !== r.trabalho_id || para.task_id !== r.task_id) {
      saida.push({ id: r.id, de: { atribuicao: r.atribuicao, trabalho_id: r.trabalho_id, task_id: r.task_id }, para });
    }
  }
  return saida;
}

/** Janelas do banco: `task.reivindicada_em → entregue_em` (aberta ⇒ fim null). Task sem `reivindicada_em` não tem janela (uso vai para `sem_card`). */
export function janelasDoBanco(tasks: ReadonlyArray<{ task_ref: string; reivindicada_em: string | null; entregue_em: string | null }>, trabalhoId: string): JanelaTask[] {
  const saida: JanelaTask[] = [];
  for (const t of tasks) {
    if (t.reivindicada_em === null) continue;
    saida.push({ trabalho_id: trabalhoId, task_id: t.task_ref, inicio: t.reivindicada_em, fim: t.entregue_em });
  }
  return saida;
}

/** Janelas do rastro: SÓ pares explícitos `task_iniciada → task_concluida`; sem `task_iniciada` não se infere janela. */
export function janelasDoRastro(eventos: ReadonlyArray<{ ts: string; evento: string; task: string | null }>, trabalhoId: string): JanelaTask[] {
  const abertas = new Map<string, string>();
  const saida: JanelaTask[] = [];
  const ordenados = [...eventos].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  for (const e of ordenados) {
    if (e.task === null) continue;
    if (e.evento === "task_iniciada") {
      if (!abertas.has(e.task)) abertas.set(e.task, e.ts);
    } else if (e.evento === "task_concluida") {
      const ini = abertas.get(e.task);
      if (ini !== undefined) {
        saida.push({ trabalho_id: trabalhoId, task_id: e.task, inicio: ini, fim: e.ts });
        abertas.delete(e.task);
      }
    }
  }
  for (const [task, ini] of abertas) saida.push({ trabalho_id: trabalhoId, task_id: task, inicio: ini, fim: null });
  return saida;
}
