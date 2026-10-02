// Orquestra a estimativa (D-185): 1) heurística IMEDIATA para todo item sem estimativa (ou com `sugerida`); 2) IA em job, fora do caminho crítico, com consentimento.
// A IA/heurística nunca sobrescrevem decisão humana (revisao.ts). Falha de qualquer porta => fica a heurística.
import type { ConfigAgil, FatoTask, ItemAgil } from "../../../compartilhado/agil";
import type { PortasAgil } from "../portas";
import type { BancoAgil } from "../repos";
import { chaveTask } from "../repos";
import { agruparRetrabalho } from "../retrabalho/agregar";
import type { GeradorId, Relogio } from "../util";
import { estimarComIa, iniciarJobEstimativa, type ResultadoIa } from "./ia";
import { estimarHeuristica, type EntradaEstimativa, type ResultadoHeuristica } from "./heuristica";
import { estimativaAtiva, proporClassificacao, proporEstimativa } from "./revisao";
import { buscarSimilares } from "./similares";

export interface DepsEstimar { banco: BancoAgil; portas: PortasAgil; relogio: Relogio; id: GeradorId; config: ConfigAgil }

export async function entradaDoItem(d: DepsEstimar, ws: string, item: ItemAgil, fato: FatoTask | null, ftrPorTipo: ReadonlyMap<string, { ftr: number; n: number }>): Promise<EntradaEstimativa> {
  const arquivos = fato?.arquivos ?? [];
  const raio = arquivos.length > 0 ? await d.portas.mapa.raio(ws, arquivos).catch(() => null) : null;
  const tipo = fato?.tipo_task ?? null;
  return {
    ref: item.id, titulo: item.titulo, descricao: item.descricao, criterios: item.criterios, tipo_task: tipo, arquivos, depende_de: fato?.depende_de ?? [], origem: item.origem,
    ocorrencia_tipo: item.origem === "ocorrencia" ? "bug" : null, valor: item.valor, urgencia: item.urgencia,
    sinais: { ...(raio?.faixa === "alto" ? { raio_alto: true } : {}), ...(raio?.sem_cobertura ? { sem_cobertura: true } : {}), ...(raio?.zona_risco ? { zona_risco_historica: true } : {}) },
    ftr_area: tipo ? ftrPorTipo.get(tipo) ?? null : null, similar_sem_retrabalho: null,
  };
}

function ftrPorTipoTask(banco: BancoAgil, ws: string): Map<string, { ftr: number; n: number }> {
  const linhas = banco.retrabalhoTasks.valores().filter((r) => r.workspace_id === ws).flatMap((r) => {
    const f = banco.fatos.get(chaveTask(ws, r.trabalho_id, r.task_ref));
    return [{ chave: `${r.trabalho_id}/${r.task_ref}`, situacao: r.situacao, eventos_pendentes: r.eventos_pendentes, pontos: null, categoria: f?.tipo_task ?? null, sprint_id: null, membro_id: null, agente: null, squad_id: null, retrabalho_ms: null }];
  });
  const out = new Map<string, { ftr: number; n: number }>();
  for (const g of agruparRetrabalho(linhas, "categoria")) if (g.resumo.first_time_right !== null) out.set(g.chave, { ftr: g.resumo.first_time_right, n: g.resumo.avaliaveis });
  return out;
}

export interface ResultadoEstimar { heuristicas_aplicadas: number; preservados_humano: number; entradas: EntradaEstimativa[]; heuristicas: Map<string, ResultadoHeuristica>; job: { job_id: string; concluido: Promise<ResultadoIa | null> } | null }

function aplicarHeuristica(d: DepsEstimar, e: EntradaEstimativa, h: ResultadoHeuristica): boolean {
  const r = proporEstimativa({ banco: d.banco, relogio: d.relogio, id: d.id, config: d.config }, { item_id: e.ref, pontos: h.pontos, origem: "ia", motor: "heuristica", confianca: h.confianca, fatores: h.fatores, min_h: null, max_h: null, nota: h.sugerir_quebra ? "acima de 13 pontos: considere quebrar" : null });
  proporClassificacao({ banco: d.banco, relogio: d.relogio, id: d.id, config: d.config }, { item_id: e.ref, categoria: h.categoria, risco: h.risco, criticidade: h.criticidade, tipo_task: h.tipo_task, risco_fatores: h.risco_fatores, motor: "heuristica", confianca: h.confianca });
  return r.aplicada;
}

export async function estimarItens(d: DepsEstimar, ws: string, itemIds: readonly string[] | "sem_estimativa"): Promise<ResultadoEstimar> {
  const alvo = (itemIds === "sem_estimativa" ? d.banco.itens.valores().filter((i) => i.workspace_id === ws && i.estado_ade !== "descartado" && !i.orfao && estimativaAtiva(d.banco, i.id) === null) : itemIds.flatMap((id) => d.banco.itens.get(id) ?? []));
  const ftr = ftrPorTipoTask(d.banco, ws);
  const res: ResultadoEstimar = { heuristicas_aplicadas: 0, preservados_humano: 0, entradas: [], heuristicas: new Map(), job: null };
  for (const it of alvo) {
    const fato = it.trabalho_id && it.task_ref ? d.banco.fatos.get(chaveTask(ws, it.trabalho_id, it.task_ref)) ?? null : null;
    const e = await entradaDoItem(d, ws, it, fato, ftr);
    const h = estimarHeuristica(e, d.config);
    res.entradas.push(e);
    res.heuristicas.set(e.ref, h);
    if (aplicarHeuristica(d, e, h)) res.heuristicas_aplicadas++; else res.preservados_humano++;
  }
  if (d.config.estimativa_modo === "ia_sugere" && res.entradas.length > 0) {
    const pend = res.entradas.filter((e) => { const a = estimativaAtiva(d.banco, e.ref); return !a || a.estado === "sugerida"; });
    if (pend.length > 0) res.job = iniciarJobEstimativa(() => estimarPorIa(d, ws, pend, res.heuristicas));
  }
  return res;
}

export async function estimarPorIa(d: DepsEstimar, ws: string, lote: readonly EntradaEstimativa[], heur: ReadonlyMap<string, ResultadoHeuristica>): Promise<ResultadoIa> {
  const contexto = new Map<string, number>();
  for (const e of lote) contexto.set(e.ref, (await buscarSimilares(d.portas.rag, ws, e.titulo)).similares.length);
  const itensDoWs = new Set(d.banco.itens.valores().filter((i) => i.workspace_id === ws).map((i) => i.id));
  const nCal = d.banco.erros.valores().filter((x) => x.razao !== null && itensDoWs.has(x.item_id)).length;
  const r = await estimarComIa({ banco: d.banco, portas: d.portas, relogio: d.relogio, config: d.config }, ws, lote, (ref) => ({ tem_criterio: (lote.find((x) => x.ref === ref)?.criterios.some((c) => c.trim()) ?? false), similares: contexto.get(ref) ?? 0, n_calibracao: nCal }));
  const dep = { banco: d.banco, relogio: d.relogio, id: d.id, config: d.config };
  d.banco.transacao(() => {
    for (const [ref, s] of r.sugestoes) {
      const h = heur.get(ref);
      proporEstimativa(dep, { item_id: ref, pontos: s.pontos, origem: "ia", motor: "llm", confianca: s.confianca_final, fatores: s.fatores, min_h: null, max_h: null, nota: s.justificativa || null });
      proporClassificacao(dep, { item_id: ref, categoria: s.categoria, risco: s.risco, criticidade: s.criticidade, tipo_task: h?.tipo_task ?? null, risco_fatores: h?.risco_fatores ?? [], motor: "llm", confianca: s.confianca_final });
    }
  });
  return r;
}
