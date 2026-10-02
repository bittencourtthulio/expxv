// Utilitários numéricos dos armazenamentos (normalização, escore 0..1, RRF).
import { avaliarFiltro, validarFiltro } from "./filtro";
import { ColecaoDivergenteErro, type Filtro, type MetricaDistancia, type RegistroConhecimento, type ResultadoBuscaArmazenamento } from "./interface";

export function normalizar(v: readonly number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  if (n === 0) return [...v];
  const inv = 1 / Math.sqrt(n);
  return v.map((x) => x * inv);
}

export function escoreDe(m: MetricaDistancia, a: readonly number[], b: readonly number[]): number {
  if (m === "euclidiana") {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += ((a[i] as number) - (b[i] as number)) ** 2;
    return 1 / (1 + Math.sqrt(s));
  }
  let d = 0;
  for (let i = 0; i < a.length; i++) d += (a[i] as number) * (b[i] as number);
  return m === "cosseno" ? (d + 1) / 2 : 1 / (1 + Math.exp(-d));
}

export function rankearRrf(listas: ReadonlyArray<readonly string[]>, k = 60): Array<{ id: string; escore: number }> {
  const s = new Map<string, number>();
  for (const l of listas) l.forEach((id, i) => s.set(id, (s.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...s.entries()].map(([id, escore]) => ({ id, escore })).sort((a, b) => b.escore - a.escore || (a.id < b.id ? -1 : 1));
}

/** Busca vetorial exata (+ RRF no cliente quando há `texto`) sobre registros em memória: base do stub e do adaptador local. */
export function buscarRegistros(regs: Iterable<RegistroConhecimento>, cfg: { dimensao: number; metrica: MetricaDistancia }, p: { vetor: number[]; texto?: string; filtro?: Filtro; k: number }): ResultadoBuscaArmazenamento[] {
  if (p.filtro) validarFiltro(p.filtro);
  if (p.vetor.length !== cfg.dimensao) throw new ColecaoDivergenteErro([`consulta com dimensão ${p.vetor.length}, esperada ${cfg.dimensao}`]);
  const q = cfg.metrica === "euclidiana" ? p.vetor : normalizar(p.vetor);
  const cand = [...regs].filter((r) => avaliarFiltro(p.filtro, r.meta));
  const porVetor = cand.map((r) => ({ r, e: escoreDe(cfg.metrica, q, r.vetor) })).sort((a, b) => b.e - a.e || (a.r.id < b.r.id ? -1 : 1));
  if (p.texto === undefined || p.texto.trim() === "") return porVetor.slice(0, p.k).map(({ r, e }) => ({ id: r.id, escore: e, texto: r.texto, meta: r.meta }));
  const termos = p.texto.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  const porTexto = cand.map((r) => ({ r, n: termos.filter((t) => r.texto.toLowerCase().includes(t)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || (a.r.id < b.r.id ? -1 : 1));
  const fund = rankearRrf([porVetor.map((x) => x.r.id), porTexto.map((x) => x.r.id)]);
  const mapaE = new Map(porVetor.map((x) => [x.r.id, x.e]));
  const porId = new Map(cand.map((r) => [r.id, r]));
  const max = fund[0]?.escore ?? 1;
  return fund.slice(0, p.k).map((f) => {
    const r = porId.get(f.id) as RegistroConhecimento;
    return { id: f.id, escore: Math.max(f.escore / max, 0) * 0.5 + (mapaE.get(f.id) ?? 0) * 0.5, texto: r.texto, meta: r.meta };
  });
}
