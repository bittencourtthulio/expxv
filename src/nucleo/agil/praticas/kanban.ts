// T-18.36: limites de WIP (Kanban opcional). Este módulo só DEFINE e MEDE `limites.wip` e emite `wip.excedido` UMA vez por episódio; o desenho do quadro vive no board
// da Fase 10 (PortaBoard). Sem Fase 10 o limite aparece só como indicador na Saúde.
import type { ConfigAgil, EventoAgil } from "../../../compartilhado/agil";
import { atualizarEpisodios, novoEvento } from "../eventos";
import type { ItemMetrica } from "../metricas/dados";
import type { PortaBoard } from "../portas";
import type { Relogio } from "../util";

export async function limitesWip(ws: string, config: Pick<ConfigAgil, "wip">, board: PortaBoard): Promise<Record<string, number>> {
  const out: Record<string, number> = { ...config.wip };
  try {
    for (const c of (await board.colunas(ws)) ?? []) { const l = await board.limiteWip(ws, c); if (l !== null) out[c] = l; }
  } catch { /* sem board: vale a config */ }
  return out;
}

export function contarPorColuna(itens: readonly ItemMetrica[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const i of itens) if (!i.descartado && !i.orfao) c[i.estado_fluxo] = (c[i.estado_fluxo] ?? 0) + 1;
  return c;
}

export function verificarWip(ws: string, relogio: Relogio, contagem: Readonly<Record<string, number>>, limites: Readonly<Record<string, number>>, episodiosAbertos: ReadonlySet<string>): { eventos: EventoAgil[]; abertos: Set<string>; excedidas: string[] } {
  const excedidas = Object.keys(limites).filter((c) => (contagem[c] ?? 0) > (limites[c] as number)).sort();
  const abertos = new Set(excedidas);
  const { novos } = atualizarEpisodios(episodiosAbertos, abertos);
  return { eventos: novos.map((c) => novoEvento("wip.excedido", ws, relogio, { dados: { coluna: c, atual: contagem[c] ?? 0, limite: limites[c] ?? null } })), abertos, excedidas };
}
