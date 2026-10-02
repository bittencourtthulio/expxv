// T-18.30: cycle time, lead time e throughput. Rótulos "duração observada" (tempo de parede, inclui pausas): NÃO é esforço.
// Cycle = último `task_iniciada` -> `task_concluida`. Lead = entrada na sprint ágil; senão `criado_em` (item que não é espelho); senão 1º evento do trabalho.
import type { DispersaoTempo, SerieDia } from "../../../compartilhado/agil";
import { diaDe, intervaloDias, ms, somarDias, diaDaSemana } from "../util";
import type { ItemMetrica } from "./dados";
import { dispersao } from "./percentis";

export function amostrasCycle(itens: readonly ItemMetrica[]): { ref: string; ms: number }[] {
  return itens.filter((i) => i.concluida_em && i.duracao_obs_ms !== null && i.duracao_obs_ms >= 0).map((i) => ({ ref: i.ref, ms: i.duracao_obs_ms as number }));
}

export function inicioDoLead(i: ItemMetrica): string | null {
  const adic = i.participacoes.map((p) => p.adicionado_em).sort()[0];
  if (adic) return adic;
  if (i.origem !== "metodo") return i.criado_em;
  return i.primeiro_evento_em;
}

export function amostrasLead(itens: readonly ItemMetrica[]): { ref: string; ms: number }[] {
  const out: { ref: string; ms: number }[] = [];
  for (const i of itens) {
    if (!i.concluida_em) continue;
    const a = ms(inicioDoLead(i));
    const b = ms(i.concluida_em);
    if (a === null || b === null || b < a) continue;
    out.push({ ref: i.ref, ms: b - a });
  }
  return out;
}

export const cycleTime = (itens: readonly ItemMetrica[], minimo = 5): DispersaoTempo => dispersao(amostrasCycle(itens), minimo);
export const leadTime = (itens: readonly ItemMetrica[], minimo = 5): DispersaoTempo => dispersao(amostrasLead(itens), minimo);

/** inicia a semana na segunda (ISO). */
export const segundaDa = (dia: string): string => somarDias(dia, -((diaDaSemana(dia) + 6) % 7));

/** tasks concluídas por dia (ou por semana, chave = segunda-feira), incluindo dias com 0 (zero conhecido). */
export function throughput(itens: readonly ItemMetrica[], de: string, ate: string, por: "dia" | "semana" = "dia"): SerieDia[] {
  const cont = new Map<string, number>();
  for (const i of itens) {
    if (!i.concluida_em) continue;
    const d = diaDe(i.concluida_em);
    if (d < de || d > ate) continue;
    const k = por === "dia" ? d : segundaDa(d);
    cont.set(k, (cont.get(k) ?? 0) + 1);
  }
  if (por === "dia") return intervaloDias(de, ate).map((d) => ({ dia: d, valor: cont.get(d) ?? 0 }));
  const semanas: string[] = [];
  for (let s = segundaDa(de); s <= ate; s = somarDias(s, 7)) semanas.push(s);
  return semanas.map((s) => ({ dia: s, valor: cont.get(s) ?? 0 }));
}
