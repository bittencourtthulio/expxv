// T-18.31: planejado × entregue. Compromisso inicial vs concluído, separando adicionado no meio, removido e carregado. Item sem pontos: fora das somas, contado à parte.
import type { PlanejadoEntregue, SprintAgil } from "../../../compartilhado/agil";
import { diaDe } from "../util";
import type { ItemMetrica } from "./dados";

export function calcularPlanejado(sprint: Pick<SprintAgil, "id" | "inicio" | "fim">, itens: readonly ItemMetrica[]): PlanejadoEntregue {
  const r: PlanejadoEntregue = { compromisso_inicial: 0, entregue_do_compromisso: 0, adicionado_meio: 0, entregue_adicionado: 0, removido: 0, carregado: 0, sem_estimativa: 0 };
  for (const i of itens) {
    const p = i.participacoes.find((x) => x.sprint_id === sprint.id);
    if (!p) continue;
    if (i.pontos === null) { r.sem_estimativa++; continue; }
    const w = p.pontos_compromisso ?? i.pontos;
    const feito = !!i.concluida_em && diaDe(i.concluida_em) <= sprint.fim;
    if (p.removido_em) { r.removido += i.pontos; continue; }
    if (p.no_compromisso_inicial) { r.compromisso_inicial += w; if (feito) r.entregue_do_compromisso += i.pontos; }
    else { r.adicionado_meio += i.pontos; if (feito) r.entregue_adicionado += i.pontos; }
    if (!feito) r.carregado += i.pontos;
  }
  // removidos que estavam no compromisso inicial também compõem o planejado original
  for (const i of itens) {
    const p = i.participacoes.find((x) => x.sprint_id === sprint.id);
    if (p?.removido_em && p.no_compromisso_inicial && i.pontos !== null) r.compromisso_inicial += p.pontos_compromisso ?? i.pontos;
  }
  return r;
}
