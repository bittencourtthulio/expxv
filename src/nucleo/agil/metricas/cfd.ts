// T-18.30: CFD (5 estados). Por dia: contagem por estado (fim do dia) e ACUMULADO (existente >= pronto-ou-além >= andamento-ou-além >= concluída-ou-além >= validada),
// cada banda não-decrescente. Estado no dia reconstruído de `criado_em`, `pronto_em`, `iniciada_em`, `concluida_em`, `validada_em`.
import type { PontoCfd, SerieCfd } from "../../../compartilhado/agil";
import { diaDe, intervaloDias } from "../util";
import type { ItemMetrica } from "./dados";

export function calcularCfd(itens: readonly ItemMetrica[], de: string, ate: string): SerieCfd {
  const dias = intervaloDias(de, ate);
  const validos = itens.filter((i) => !i.descartado && !i.orfao);
  const d0 = (x: string | null): string => (x ? diaDe(x) : "9999-12-31");
  const pre = validos.map((i) => {
    const criado = diaDe(i.primeiro_evento_em && i.origem === "metodo" ? i.primeiro_evento_em : i.criado_em);
    const valida = d0(i.validada_em);
    const concl = d0(i.concluida_em);
    const ini = d0(i.iniciada_em);
    const pronto = d0(i.pronto_em);
    // monotonia: etapa posterior nunca antes da anterior (dado inconsistente é ajustado, não propagado)
    const eConcl = concl < ini && ini !== "9999-12-31" ? ini : concl;
    const eVal = valida < eConcl ? eConcl : valida;
    const eIni = ini === "9999-12-31" ? eConcl : ini;
    const ePronto = pronto > eIni ? eIni : pronto;
    return { criado: criado > ePronto ? ePronto : criado, ePronto, eIni, eConcl, eVal };
  });
  const por: PontoCfd[] = [];
  const acum: PontoCfd[] = [];
  for (const d of dias) {
    let existe = 0; let pr = 0; let an = 0; let co = 0; let va = 0;
    for (const p of pre) {
      if (p.criado > d) continue;
      existe++;
      if (p.ePronto <= d) pr++;
      if (p.eIni <= d) an++;
      if (p.eConcl <= d) co++;
      if (p.eVal <= d) va++;
    }
    acum.push({ dia: d, backlog: existe, pronto: pr, em_andamento: an, concluida: co, validada: va });
    por.push({ dia: d, backlog: existe - pr, pronto: pr - an, em_andamento: an - co, concluida: co - va, validada: va });
  }
  return { dias: por, acumulado: acum };
}
