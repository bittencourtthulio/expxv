// T-18.25: sugestão de compromisso. Guloso pela ORDEM do backlog até capacidade × (1 − buffer), respeitando `depende_de`; AVISA, nunca bloqueia.
import type { ConfigAgil } from "../../../compartilhado/agil";
import type { ItemMetrica } from "../metricas/dados";

export interface CandidatoPlanejamento { item_id: string; titulo: string; ordem: number; pontos: number | null; risco: string | null; depende_de: string[]; concluido: boolean }
export type AvisoPlanejamento =
  | { tipo: "excede_capacidade"; pontos: number; capacidade: number }
  | { tipo: "sem_estimativa"; itens: string[] }
  | { tipo: "risco_critico_demais"; n: number; limite: number }
  | { tipo: "dependencia_fora"; item_id: string; depende_de: string }
  | { tipo: "capacidade_sem_base" };

export interface SugestaoSprint { itens: string[]; pontos: number; capacidade: number | null; limite: number | null; avisos: AvisoPlanejamento[] }

export function candidatosDoBacklog(itens: readonly ItemMetrica[]): CandidatoPlanejamento[] {
  const porRef = new Map<string, ItemMetrica>();
  for (const i of itens) if (i.trabalho_id && i.task_ref) porRef.set(`${i.trabalho_id}|${i.task_ref}`, i);
  return itens.filter((i) => !i.descartado && !i.orfao && i.estado_fluxo !== "concluida" && i.estado_fluxo !== "validada").map((i, idx) => ({
    item_id: i.item_id, titulo: i.titulo, ordem: idx, pontos: i.pontos, risco: i.risco,
    depende_de: i.trabalho_id ? i.depende_de.map((r) => porRef.get(`${i.trabalho_id}|${r}`)?.item_id).filter((x): x is string => !!x) : [],
    concluido: i.estado_fluxo === "concluida" || i.estado_fluxo === "validada",
  }));
}

export function sugerirCompromisso(p: { candidatos: readonly CandidatoPlanejamento[]; concluidos: ReadonlySet<string>; capacidade: number | null; config: Pick<ConfigAgil, "buffer_planejamento" | "limiares_saude"> }): SugestaoSprint {
  const avisos: AvisoPlanejamento[] = [];
  const ord = [...p.candidatos].sort((a, b) => a.ordem - b.ordem);
  const semEst = ord.filter((c) => c.pontos === null).map((c) => c.item_id);
  if (semEst.length > 0) avisos.push({ tipo: "sem_estimativa", itens: semEst });
  if (p.capacidade === null) { avisos.push({ tipo: "capacidade_sem_base" }); return { itens: [], pontos: 0, capacidade: null, limite: null, avisos }; }
  const limite = p.capacidade * (1 - p.config.buffer_planejamento);
  const escolhidos = new Set<string>();
  let total = 0;
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const c of ord) {
      if (escolhidos.has(c.item_id) || c.pontos === null) continue;
      const pronto = c.depende_de.every((d) => p.concluidos.has(d) || escolhidos.has(d));
      if (!pronto || total + c.pontos > limite) continue;
      escolhidos.add(c.item_id);
      total += c.pontos;
      mudou = true;
    }
  }
  const lista = ord.filter((c) => escolhidos.has(c.item_id)).map((c) => c.item_id);
  for (const c of ord) if (escolhidos.has(c.item_id)) for (const d of c.depende_de) if (!p.concluidos.has(d) && !escolhidos.has(d)) avisos.push({ tipo: "dependencia_fora", item_id: c.item_id, depende_de: d });
  const criticos = ord.filter((c) => escolhidos.has(c.item_id) && c.risco === "critico").length;
  if (criticos > p.config.limiares_saude.risco_critico_max) avisos.push({ tipo: "risco_critico_demais", n: criticos, limite: p.config.limiares_saude.risco_critico_max });
  return { itens: lista, pontos: total, capacidade: p.capacidade, limite, avisos };
}

/** avisos de um compromisso ESCOLHIDO pelo humano (manual): avisa, nunca bloqueia. */
export function avisosDoCompromisso(candidatos: readonly CandidatoPlanejamento[], escolhidos: ReadonlySet<string>, concluidos: ReadonlySet<string>, capacidade: number | null, config: Pick<ConfigAgil, "limiares_saude">): AvisoPlanejamento[] {
  const avisos: AvisoPlanejamento[] = [];
  const sel = candidatos.filter((c) => escolhidos.has(c.item_id));
  const semEst = sel.filter((c) => c.pontos === null).map((c) => c.item_id);
  if (semEst.length) avisos.push({ tipo: "sem_estimativa", itens: semEst });
  const pontos = sel.reduce((a, c) => a + (c.pontos ?? 0), 0);
  if (capacidade === null) avisos.push({ tipo: "capacidade_sem_base" });
  else if (pontos > capacidade) avisos.push({ tipo: "excede_capacidade", pontos, capacidade });
  for (const c of sel) for (const d of c.depende_de) if (!concluidos.has(d) && !escolhidos.has(d)) avisos.push({ tipo: "dependencia_fora", item_id: c.item_id, depende_de: d });
  const criticos = sel.filter((c) => c.risco === "critico").length;
  if (criticos > config.limiares_saude.risco_critico_max) avisos.push({ tipo: "risco_critico_demais", n: criticos, limite: config.limiares_saude.risco_critico_max });
  return avisos;
}
