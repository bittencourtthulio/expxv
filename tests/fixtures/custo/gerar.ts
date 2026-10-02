// Fixtures determinísticas da Fase 10 (sem Electron, sem rede): trabalhos do método sintéticos para o board e transcript-like de registros de uso para o custo.
import type { CustoResumo, RegistroExtraido } from "../../../src/compartilhado/custo";
import { resumir } from "../../../src/nucleo/custo/agregar";
import type { PaneParaBoard, TaskDoBanco, TaskDoMetodo, TrabalhoDoMetodo } from "../../../src/nucleo/board/portas";

export const WS = "ws_FIXTURE00000001";

export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function task(id: string, p: Partial<TaskDoMetodo> = {}): TaskDoMetodo {
  return {
    id, titulo: `Task ${id}`, fase: "F1", status: "pendente", depende_de: [], suite: "nao_executada", concluida_em: null, duracao_observada_ms: null,
    objetivo: `Objetivo ${id}`, criterio_aceite: "aceite", teste_integracao: "int", teste_funcional: "fun", teste_regressao: "reg", arquivo: `docs/sprintx/f/${id}.md`, ...p,
  };
}
export function trabalho(id: string, tasks: TaskDoMetodo[], p: Partial<TrabalhoDoMetodo> = {}): TrabalhoDoMetodo {
  return { id, titulo: `Trabalho ${id}`, workspace_id: WS, mission_id: null, veredito_qa: null, tasks, violacoes: [], ...p };
}
export const bancoTask = (trabalho_id: string, task_ref: string, p: Partial<TaskDoBanco> = {}): TaskDoBanco => ({ workspace_id: WS, trabalho_id, task_ref, estado: "aberta", pane_id: null, handoff_status: null, ...p });
export const paneBoard = (p: Partial<PaneParaBoard> = {}): PaneParaBoard => ({ cli: "claude", modelo: "claude-sonnet-4-5", conta_rotulo: "c1", papel: "executor", ...p });

/** Resumo de custo sintético (já agregado). */
export function custoDe(usd: number | null, p: { incompleto?: boolean; modelos?: string[] } = {}): CustoResumo {
  const base = resumir(usd === null ? [] : [{ atribuicao: "card", modelo: p.modelos?.[0] ?? "m", registros: 1, registros_sem_preco: 0, registros_aproximados: 0, tokens_entrada: 1000, tokens_cache_escrita: 0, tokens_cache_leitura: 0, tokens_saida: 100, usd_conhecido: usd }]);
  return { ...base, incompleto: p.incompleto ?? base.incompleto, modelos: p.modelos ?? base.modelos };
}

/** `n` trabalhos × `porTrabalho` tasks em estados variados (determinístico). */
export function gerarVolumeBoard(n: number, porTrabalho: number, seed = 7): { trabalhos: TrabalhoDoMetodo[]; tasksBanco: TaskDoBanco[]; custos: Map<string, CustoResumo> } {
  const r = prng(seed);
  const trabalhos: TrabalhoDoMetodo[] = [];
  const tasksBanco: TaskDoBanco[] = [];
  const custos = new Map<string, CustoResumo>();
  const estados: TaskDoMetodo["status"][] = ["pendente", "pendente", "em_andamento", "concluida", "concluida", "bloqueada"];
  for (let t = 0; t < n; t++) {
    const id = `feat-${String(t).padStart(3, "0")}`;
    const tasks: TaskDoMetodo[] = [];
    for (let k = 0; k < porTrabalho; k++) {
      const tid = `T-${String(1 + Math.floor(k / 5)).padStart(2, "0")}.${String(1 + (k % 5)).padStart(2, "0")}`;
      const status = estados[Math.floor(r() * estados.length)] as TaskDoMetodo["status"];
      tasks.push(task(tid, { status, fase: `F${1 + Math.floor(k / 5)}`, depende_de: k > 0 && r() < 0.4 ? [tasks[k - 1]?.id as string] : [], concluida_em: status === "concluida" ? `2026-06-${String(1 + (k % 28)).padStart(2, "0")}T10:00:00.000Z` : null }));
      if (r() < 0.5) custos.set(`${WS}|${id}|${tid}`, custoDe(Math.round(r() * 500) / 100, { modelos: ["claude-sonnet-4-5"] }));
      if (r() < 0.1) tasksBanco.push(bancoTask(id, tid, { estado: r() < 0.5 ? "reivindicada" : "entregue" }));
    }
    trabalhos.push(trabalho(id, tasks, { veredito_qa: r() < 0.3 ? "aprovado" : null }));
  }
  return { trabalhos, tasksBanco, custos };
}

/** Linhas de uso SINTÉTICAS no formato já extraído (só ts/modelo/tokens/chave/usd): nunca contêm conteúdo de conversa. */
export function gerarRegistros(n: number, seed = 3, inicio = "2026-06-01T00:00:00.000Z"): RegistroExtraido[] {
  const r = prng(seed);
  const modelos = ["claude-sonnet-4-5", "claude-opus-4-5-20251101", "gpt-5", "modelo-sem-preco"];
  const t0 = Date.parse(inicio);
  return Array.from({ length: n }, (_, i) => ({
    chave: `msg_${seed}_${i}`,
    ts: new Date(t0 + i * 20_000).toISOString(),
    modelo: modelos[Math.floor(r() * modelos.length)] as string,
    tokens: { entrada: Math.floor(r() * 5000), cache_escrita: Math.floor(r() * 2000), cache_leitura: Math.floor(r() * 50000), saida: Math.floor(r() * 3000) },
  }));
}
