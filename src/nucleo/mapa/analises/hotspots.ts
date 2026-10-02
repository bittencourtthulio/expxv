// Hotspots (T-17.27): `score = rank_pct(churn_janela) × rank_pct(complexidade_max)` (ideia de Tornhill, reimplementada).
// Puro. Sem história git (`churn_janela` ausente) não há hotspot: devolve `indisponivel` (o raio trata como pior caso).

export interface EntradaHotspot {
  caminho: string;
  churn_janela: number | null;
  complexidade_max: number | null;
  autores_n?: number | null;
  criado_git?: string | null;
  ultima_alt?: string | null;
  commits_correcao?: number | null;
}

export interface ParceiroAcoplamento {
  a: string;
  b: string;
  co_alteracoes: number;
  grau: number;
}

export type FaixaHotspot = "quente" | "morno" | "frio";

export interface Hotspot {
  caminho: string;
  score: number;
  faixa: FaixaHotspot;
  churn_janela: number;
  complexidade_max: number;
  autores_n: number | null;
  idade_dias: number | null;
  commits_correcao: number | null;
  parceiros: Array<{ caminho: string; co_alteracoes: number; grau: number }>;
}

export interface ResultadoHotspots {
  /** `false` quando nenhum arquivo tem churn: a história é indisponível. */
  disponivel: boolean;
  hotspots: Hotspot[];
}

export const LIMIAR_QUENTE = 0.6;
export const LIMIAR_MORNO = 0.25;

/** Posto percentil 0..1 de cada valor (empates pelo posto médio); o maior vale 1 e o menor 0. */
export function rankPercentil(valores: readonly number[]): number[] {
  const n = valores.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const ordenado = [...valores].sort((a, b) => a - b);
  const primeiro = new Map<number, number>();
  const contagem = new Map<number, number>();
  ordenado.forEach((v, i) => {
    if (!primeiro.has(v)) primeiro.set(v, i);
    contagem.set(v, (contagem.get(v) ?? 0) + 1);
  });
  return valores.map((v) => ((primeiro.get(v) as number) + ((contagem.get(v) as number) - 1) / 2) / (n - 1));
}

export function faixaDoScore(score: number): FaixaHotspot {
  return score >= LIMIAR_QUENTE ? "quente" : score >= LIMIAR_MORNO ? "morno" : "frio";
}

export function calcularHotspots(arquivos: readonly EntradaHotspot[], acoplamentos: readonly ParceiroAcoplamento[] = [], agora: Date = new Date()): ResultadoHotspots {
  const com = arquivos.filter((a) => a.churn_janela !== null && a.complexidade_max !== null);
  if (com.length === 0 || !com.some((a) => (a.churn_janela as number) > 0)) return { disponivel: false, hotspots: [] };
  const rc = rankPercentil(com.map((a) => a.churn_janela as number));
  const rx = rankPercentil(com.map((a) => a.complexidade_max as number));
  const parceiros = new Map<string, Array<{ caminho: string; co_alteracoes: number; grau: number }>>();
  const juntar = (de: string, para: string, p: ParceiroAcoplamento): void => {
    let l = parceiros.get(de);
    if (l === undefined) parceiros.set(de, (l = []));
    l.push({ caminho: para, co_alteracoes: p.co_alteracoes, grau: p.grau });
  };
  for (const p of acoplamentos) {
    juntar(p.a, p.b, p);
    juntar(p.b, p.a, p);
  }
  const hs: Hotspot[] = com.map((a, i) => {
    const churn = a.churn_janela as number;
    const cx = a.complexidade_max as number;
    const score = churn === 0 || cx === 0 ? 0 : Math.round((rc[i] as number) * (rx[i] as number) * 10_000) / 10_000;
    const criado = a.criado_git !== undefined && a.criado_git !== null ? Date.parse(a.criado_git) : NaN;
    return {
      caminho: a.caminho,
      score,
      faixa: faixaDoScore(score),
      churn_janela: churn,
      complexidade_max: cx,
      autores_n: a.autores_n ?? null,
      idade_dias: Number.isNaN(criado) ? null : Math.max(0, Math.floor((agora.getTime() - criado) / 86_400_000)),
      commits_correcao: a.commits_correcao ?? null,
      parceiros: (parceiros.get(a.caminho) ?? []).sort((x, y) => y.grau - x.grau || y.co_alteracoes - x.co_alteracoes || x.caminho.localeCompare(y.caminho)).slice(0, 3),
    };
  });
  hs.sort((x, y) => y.score - x.score || y.churn_janela - x.churn_janela || x.caminho.localeCompare(y.caminho));
  return { disponivel: true, hotspots: hs };
}
