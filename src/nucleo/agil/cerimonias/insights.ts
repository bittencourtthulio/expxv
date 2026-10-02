// T-18.28: insights DETERMINÍSTICOS para a retrospectiva assistida por dados (nada de IA): top retrabalho, QA reprovado, atrasos, maiores erros de estimativa,
// WIP médio vs limite, bloqueios mais longos, FTR da sprint vs média móvel, ações da retro anterior NÃO cumpridas.
import { detectarAtrasadas } from "../eventos";
import type { ItemMetrica } from "../metricas/dados";
import type { ErroEstimativaRegistro, RetroAcao } from "../repos";

export interface EntradaInsights {
  itens: readonly ItemMetrica[];
  /** eventos de retrabalho ATIVOS e fortes de defeito por `trabalho/task`. */
  eventos_por_ref: ReadonlyMap<string, number>;
  erros: readonly ErroEstimativaRegistro[];
  titulos: ReadonlyMap<string, string>;
  wip_medio: number | null;
  wip_limite: number | null;
  bloqueios: readonly { ref: string; dias: number }[];
  ftr_sprint: number | null;
  ftr_media_movel: number | null;
  acoes_anteriores: readonly RetroAcao[];
  hoje: string;
  agora: number;
}
export interface Insights {
  top_retrabalho: { ref: string; titulo: string; eventos: number }[];
  qa_reprovado: { ref: string; titulo: string; reprovacoes: number }[];
  atrasos: { ref: string; titulo: string; horas: number }[];
  maiores_erros: { item_id: string; titulo: string; razao: number }[];
  wip: { medio: number | null; limite: number | null; acima: boolean | null };
  bloqueios_longos: { ref: string; dias: number }[];
  ftr: { sprint: number | null; media_movel: number | null; abaixo: boolean | null };
  acoes_nao_cumpridas: { id: string; texto: string; prazo: string | null; vencida: boolean }[];
}

const TOP = 5;
export function calcularInsights(e: EntradaInsights): Insights {
  const tit = (ref: string, fallback: string): string => e.titulos.get(ref) ?? fallback;
  const top_retrabalho = [...e.eventos_por_ref.entries()].filter(([, n]) => n > 0).sort(([ra, a], [rb, b]) => b - a || ra.localeCompare(rb)).slice(0, TOP).map(([ref, eventos]) => ({ ref, titulo: tit(ref, ref), eventos }));
  const qa_reprovado = e.itens.filter((i) => i.qa_reprovacoes > 0).sort((a, b) => b.qa_reprovacoes - a.qa_reprovacoes || a.ref.localeCompare(b.ref)).slice(0, TOP).map((i) => ({ ref: i.ref, titulo: i.titulo, reprovacoes: i.qa_reprovacoes }));
  const atrasos = detectarAtrasadas(e.itens, e.agora).atrasadas.sort((a, b) => b.idade_ms - a.idade_ms).slice(0, TOP).map((a) => ({ ref: a.item.ref, titulo: a.item.titulo, horas: Math.round(a.idade_ms / 3_600_000) }));
  const maiores_erros = e.erros.filter((x) => x.razao !== null).sort((a, b) => Math.abs((b.razao as number) - 1) - Math.abs((a.razao as number) - 1) || a.item_id.localeCompare(b.item_id)).slice(0, TOP).map((x) => ({ item_id: x.item_id, titulo: e.titulos.get(x.item_id) ?? x.item_id, razao: Math.round((x.razao as number) * 100) / 100 }));
  return {
    top_retrabalho, qa_reprovado, atrasos, maiores_erros,
    wip: { medio: e.wip_medio, limite: e.wip_limite, acima: e.wip_medio !== null && e.wip_limite !== null ? e.wip_medio > e.wip_limite : null },
    bloqueios_longos: [...e.bloqueios].sort((a, b) => b.dias - a.dias || a.ref.localeCompare(b.ref)).slice(0, TOP),
    ftr: { sprint: e.ftr_sprint, media_movel: e.ftr_media_movel, abaixo: e.ftr_sprint !== null && e.ftr_media_movel !== null ? e.ftr_sprint < e.ftr_media_movel : null },
    acoes_nao_cumpridas: e.acoes_anteriores.filter((a) => a.estado === "aberta").map((a) => ({ id: a.id, texto: a.texto, prazo: a.prazo, vencida: a.prazo !== null && a.prazo < e.hoje })),
  };
}
