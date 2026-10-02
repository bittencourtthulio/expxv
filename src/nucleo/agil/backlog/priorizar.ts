// T-18.10: priorização. WSJF = (valor + urgência + redução de risco) / pontos (null sem pontos/sem notas). A ORDEM MANUAL (índice fracionário) vence qualquer cálculo.
import type { ItemAgil } from "../../../compartilhado/agil";

export function wsjf(i: Pick<ItemAgil, "valor" | "urgencia" | "reducao_risco">, pontos: number | null): number | null {
  if (pontos === null || pontos <= 0) return null;
  if (i.valor === null && i.urgencia === null && i.reducao_risco === null) return null;
  return Math.round((((i.valor ?? 0) + (i.urgencia ?? 0) + (i.reducao_risco ?? 0)) / pontos) * 1000) / 1000;
}

const PESO_MOSCOW: Record<string, number> = { must: 0, should: 1, could: 2, wont: 3 };
export const rankMoscow = (m: string | null): number => (m === null ? 4 : PESO_MOSCOW[m] ?? 4);

/** valor × esforço: quadrante pela mediana dos limiares (valor >= 6 é alto; esforço <= 3 pontos é baixo). */
export function quadranteValorEsforco(valor: number | null, pontos: number | null): "ganho_rapido" | "grande_aposta" | "preencher" | "evitar" | null {
  if (valor === null || pontos === null) return null;
  const alto = valor >= 6;
  const baixo = pontos <= 3;
  return alto && baixo ? "ganho_rapido" : alto ? "grande_aposta" : baixo ? "preencher" : "evitar";
}

export type CriterioOrdem = "ordem" | "wsjf" | "valor_esforco";
export function ordenarBacklog<T extends { item: ItemAgil; pontos: number | null }>(lista: readonly T[], por: CriterioOrdem): T[] {
  const cmpOrdem = (a: T, b: T): number => a.item.ordem - b.item.ordem || a.item.id.localeCompare(b.item.id);
  const copia = [...lista];
  if (por === "ordem") return copia.sort(cmpOrdem);
  if (por === "wsjf") return copia.sort((a, b) => (wsjf(b.item, b.pontos) ?? -Infinity) - (wsjf(a.item, a.pontos) ?? -Infinity) || cmpOrdem(a, b));
  const q = { ganho_rapido: 0, grande_aposta: 1, preencher: 2, evitar: 3 } as const;
  return copia.sort((a, b) => {
    const qa = quadranteValorEsforco(a.item.valor, a.pontos); const qb = quadranteValorEsforco(b.item.valor, b.pontos);
    return (qa ? q[qa] : 9) - (qb ? q[qb] : 9) || cmpOrdem(a, b);
  });
}

const PASSO = 1024;
const LACUNA_MIN = 1e-9;
/** posição de `itemId` imediatamente ANTES de `antesId` (null = no fim). Reordenar = 1 UPDATE; só rebalanceia quando a lacuna < 1e-9. */
export function reordenar(ordenado: readonly { id: string; ordem: number }[], itemId: string, antesId: string | null): { ordem: number; rebalanceados: Map<string, number> | null } {
  const lista = ordenado.filter((x) => x.id !== itemId);
  const idx = antesId === null ? lista.length : lista.findIndex((x) => x.id === antesId);
  if (idx < 0) throw new Error(`antes_id desconhecido: ${antesId}`);
  const ant = lista[idx - 1]?.ordem;
  const prox = lista[idx]?.ordem;
  const calc = (): number | null => {
    if (ant === undefined && prox === undefined) return PASSO;
    if (ant === undefined) return (prox as number) - PASSO;
    if (prox === undefined) return ant + PASSO;
    const meio = (ant + prox) / 2;
    return prox - ant < LACUNA_MIN * 2 || meio <= ant || meio >= prox ? null : meio;
  };
  const ordem = calc();
  if (ordem !== null) return { ordem, rebalanceados: null };
  const reb = new Map<string, number>();
  const nova = [...lista.slice(0, idx), { id: itemId, ordem: 0 }, ...lista.slice(idx)];
  nova.forEach((x, i) => reb.set(x.id, (i + 1) * PASSO));
  return { ordem: reb.get(itemId) as number, rebalanceados: reb };
}
