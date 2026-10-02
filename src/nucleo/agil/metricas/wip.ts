// T-18.30: WIP por dia (reconstruído dos intervalos `task_iniciada` -> `task_concluida` do rastro) e idade do WIP. Tarefa bloqueada continua em andamento.
import type { SerieWip } from "../../../compartilhado/agil";
import { fimDoDia, intervaloDias, ms } from "../util";
import type { ItemMetrica } from "./dados";

export function calcularWip(itens: readonly ItemMetrica[], de: string, ate: string, agora: number, limite: number | null = null): SerieWip {
  const ivs = itens.flatMap((i) => i.intervalos.map(([a, b]) => ({ a: ms(a) as number, b: b ? (ms(b) as number) : Infinity })).filter((x) => Number.isFinite(x.a)));
  const dias = intervaloDias(de, ate).map((d) => {
    const t = Math.min(fimDoDia(d), agora);
    let n = 0;
    for (const x of ivs) if (x.a <= t && t < x.b) n++;
    return { dia: d, valor: n };
  });
  const idade: { ref: string; idade_ms: number }[] = [];
  for (const i of itens) {
    if (i.estado_fluxo !== "em_andamento") continue;
    const aberto = i.intervalos.find(([, b]) => b === null);
    const ini = ms(aberto?.[0] ?? i.iniciada_em);
    if (ini !== null) idade.push({ ref: i.ref, idade_ms: Math.max(0, agora - ini) });
  }
  idade.sort((a, b) => b.idade_ms - a.idade_ms);
  return { dias, limite, idade };
}
