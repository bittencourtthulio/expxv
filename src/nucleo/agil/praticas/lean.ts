// T-18.36: desperdícios Lean MEDIDOS (espera, retrabalho, trabalho parcial, troca de contexto, descartes após início, defeitos escapados), eficiência de fluxo e valor entregue.
// Sem fonte => null (nunca zero): eficiência de fluxo é `null` sem PortaCusto.
import type { ResumoRetrabalho } from "../../../compartilhado/agil";
import { arredondar } from "../util";
import type { ItemMetrica } from "../metricas/dados";
import { amostrasLead } from "../metricas/fluxo";

export interface Desperdicios {
  espera_ms: number | null;
  retrabalho_ir: number | null;
  trabalho_parcial: number;
  troca_de_contexto: { media: number | null; por_membro: { membro_id: string; simultaneas: number }[] };
  descartes_apos_inicio: number;
  defeitos_escapados: number | null;
}

export function desperdiciosLean(p: { itens: readonly ItemMetrica[]; retrabalho: ResumoRetrabalho; defeitos_escapados: number | null }): Desperdicios {
  const bloq = p.itens.map((i) => i.bloqueada_ms).filter((x): x is number => x !== null);
  const andamento = p.itens.filter((i) => i.estado_fluxo === "em_andamento");
  const por = new Map<string, number>();
  for (const i of andamento) por.set(i.membro_id ?? "sem_dono", (por.get(i.membro_id ?? "sem_dono") ?? 0) + 1);
  const por_membro = [...por.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([membro_id, simultaneas]) => ({ membro_id, simultaneas }));
  return {
    espera_ms: bloq.length ? bloq.reduce((a, b) => a + b, 0) : null,
    retrabalho_ir: p.retrabalho.ir,
    trabalho_parcial: andamento.length,
    troca_de_contexto: { media: por_membro.length ? arredondar(por_membro.reduce((a, m) => a + m.simultaneas, 0) / por_membro.length, 2) : null, por_membro },
    descartes_apos_inicio: p.itens.filter((i) => i.descartado && i.iniciada_em !== null).length,
    defeitos_escapados: p.defeitos_escapados,
  };
}

/** eficiência de fluxo = tempo com atividade observada (PortaCusto) ÷ lead time. Qualquer fonte ausente => null. */
export function eficienciaDeFluxo(itens: readonly ItemMetrica[], ativoMsPorRef: ReadonlyMap<string, number> | null): number | null {
  if (!ativoMsPorRef) return null;
  const leads = new Map(amostrasLead(itens).map((a) => [a.ref, a.ms]));
  let ativo = 0; let lead = 0;
  for (const [ref, l] of leads) { const a = ativoMsPorRef.get(ref); if (a === undefined || l <= 0) continue; ativo += Math.min(a, l); lead += l; }
  return lead === 0 ? null : arredondar(ativo / lead);
}

export function valorEntregue(itens: readonly ItemMetrica[]): { valor_total: number | null; por_ponto: number | null } {
  const feitos = itens.filter((i) => i.concluida_em && i.valor !== null);
  if (feitos.length === 0) return { valor_total: null, por_ponto: null };
  const total = feitos.reduce((a, i) => a + (i.valor as number), 0);
  const pts = feitos.filter((i) => i.pontos !== null).reduce((a, i) => a + (i.pontos as number), 0);
  return { valor_total: total, por_ponto: pts > 0 ? arredondar(total / pts) : null };
}
