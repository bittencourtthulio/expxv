// T-18.30: burndown/burnup. Escopo vigente por dia = Σ pesos dos itens ativos na sprint naquele dia (adições/remoções por `adicionado_em`/`removido_em`);
// concluído = Σ pesos com `concluida_em` <= dia. Ideal: do COMPROMISSO INICIAL ao zero, em dias úteis (com feriados). Dias futuros: null. Item sem pontos: fora da soma ("N sem estimativa").
import type { ConfigAgil, PontoBurn, SerieBurn, SprintAgil } from "../../../compartilhado/agil";
import { arredondar, diaDe, diasUteis, intervaloDias } from "../util";
import type { ItemMetrica } from "./dados";

export interface EntradaBurn {
  sprint: Pick<SprintAgil, "id" | "inicio" | "fim" | "compromisso_pontos">;
  itens: readonly ItemMetrica[];
  unidade: "pontos" | "itens";
  config: Pick<ConfigAgil, "dias_uteis" | "feriados">;
  /** dia (AAAA-MM-DD) de "hoje"; dias depois dele ficam null. */
  hoje: string;
}

export function calcularBurn(e: EntradaBurn): SerieBurn {
  const { sprint } = e;
  const peso = (i: ItemMetrica): number | null => (e.unidade === "itens" ? 1 : i.pontos);
  const membros = e.itens.flatMap((i) => { const p = i.participacoes.find((x) => x.sprint_id === sprint.id); return p ? [{ i, p }] : []; });
  const comPeso = membros.filter(({ i }) => peso(i) !== null);
  const semEst = e.unidade === "pontos" ? membros.length - comPeso.length : 0;
  const inicial = e.unidade === "itens"
    ? membros.filter(({ p }) => p.no_compromisso_inicial).length
    : sprint.compromisso_pontos ?? comPeso.filter(({ p }) => p.no_compromisso_inicial).reduce((a, { i, p }) => a + (p.pontos_compromisso ?? (peso(i) as number)), 0);
  const dias = intervaloDias(sprint.inicio, sprint.fim);
  const uteis = diasUteis(sprint.inicio, sprint.fim, e.config);
  const N = uteis.length || dias.length;
  const lista = uteis.length ? uteis : dias;
  const pontos: PontoBurn[] = dias.map((d) => {
    let escopo = 0; let concl = 0;
    for (const { i, p } of comPeso) {
      const w = peso(i) as number;
      if (diaDe(p.adicionado_em) > d) continue;
      if (p.removido_em && diaDe(p.removido_em) <= d) continue;
      escopo += w;
      if (i.concluida_em && diaDe(i.concluida_em) <= d) concl += w;
    }
    const k = lista.filter((u) => u <= d).length;
    const futuro = d > e.hoje;
    return { dia: d, escopo, concluido: futuro ? null : concl, restante: futuro ? null : escopo - concl, ideal: arredondar(inicial * (1 - k / N)) };
  });
  return { unidade: e.unidade, sprint_id: sprint.id, dias: pontos, compromisso_inicial: inicial, sem_estimativa: semEst };
}
