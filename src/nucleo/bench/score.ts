// Score, veredito, comparar, recomendar e rascunho de política: código PURO (sem I/O, sem relógio). Métrica bruta é a verdade; o `composite` é derivado e RECALCULADO por conjunto de alvos
// (a normalização pelo mínimo muda quando um alvo novo entra, por isso nada disso é gravado). Custo desconhecido nunca vira zero: o conjunto renormaliza os pesos e marca "sem custo".
import { PESOS_PADRAO, type AgregadoAlvo, type CelulaComparacao, type Comparacao, type Estrategia, type ItemRecomendacao, type LinhaComparacao, type PesosScore, type RascunhoPolitica, type Recomendacao, type Restricoes, type SeloComparacao } from "./tipos";
import { taskTypeDaAtividade } from "./mapa-atividades";

/** Métricas brutas de UM resultado, o suficiente para pontuar. */
export interface EntradaScore {
  resultado_id: string;
  alvo: string;
  qualidade: number | null;
  duracao_s: number | null;
  custo_usd: number | null;
  /** alguma checagem crítica falhou. */
  critica_falhou: boolean;
  revisoes: number | null;
  tokens_out?: number | null;
  estado?: string;
}
export interface SaidaScore {
  alvo: string;
  resultado_id: string;
  q: number | null;
  s: number | null;
  c: number | null;
  /** `null` = sem qualidade (não julgado): fica fora do ranking. */
  composite: number | null;
  sem_custo: boolean;
  nao_comparavel: boolean;
}

const LIMITE_PORTAO = 4;
const EMPATE = 1.0;

export function normalizarPesos(p: PesosScore): PesosScore {
  const ok = [p.q, p.s, p.c].every((x) => Number.isFinite(x) && x >= 0) && p.q + p.s + p.c > 0;
  return ok ? p : PESOS_PADRAO;
}

/** Pontua os alvos de UMA tarefa (mesma versão). A ordem de saída é a de entrada. */
export function pontuarTarefa(entradas: readonly EntradaScore[], pesosBrutos: PesosScore = PESOS_PADRAO): SaidaScore[] {
  const pesos = normalizarPesos(pesosBrutos);
  const unico = entradas.length === 1;
  const semCustoNoConjunto = entradas.some((e) => e.custo_usd === null);
  let minDur = Infinity;
  let minCusto = Infinity;
  for (const e of entradas) {
    if (e.duracao_s !== null && e.duracao_s > 0 && e.duracao_s < minDur) minDur = e.duracao_s;
    if (e.custo_usd !== null && e.custo_usd >= 0 && e.custo_usd < minCusto) minCusto = e.custo_usd;
  }
  return entradas.map((e): SaidaScore => {
    if (e.qualidade === null) return { alvo: e.alvo, resultado_id: e.resultado_id, q: null, s: null, c: null, composite: null, sem_custo: semCustoNoConjunto, nao_comparavel: unico };
    const q = Math.max(0, Math.min(10, e.qualidade)) / 10;
    const portao = e.qualidade < LIMITE_PORTAO || e.critica_falhou;
    let s: number;
    let c: number;
    if (unico) { s = 1; c = 1; }
    else if (portao) { s = 0; c = 0; }
    else {
      s = e.duracao_s !== null && e.duracao_s > 0 && Number.isFinite(minDur) ? minDur / e.duracao_s : 0;
      c = e.custo_usd === null ? 0 : e.custo_usd <= 0 ? 1 : minCusto / e.custo_usd;
    }
    let composite: number;
    if (semCustoNoConjunto && !unico) composite = (100 * (pesos.q * q + pesos.s * s)) / (pesos.q + pesos.s || 1);
    else composite = 100 * (pesos.q * q + pesos.s * s + pesos.c * c);
    if (e.revisoes !== null && e.revisoes > 0) composite *= Math.max(0, 1 - 0.05 * e.revisoes);
    return { alvo: e.alvo, resultado_id: e.resultado_id, q, s, c, composite: arred(composite), sem_custo: semCustoNoConjunto, nao_comparavel: unico };
  });
}

const arred = (x: number): number => Math.round(x * 1000) / 1000;

/** Vencedor de uma tarefa: maior composite; |Δ| < 1,0 desempata por menor custo conhecido, depois menos revisões, depois slug. `null` = empate real ou ninguém pontuou. */
export function vencedorDaTarefa(entradas: readonly EntradaScore[], saidas: readonly SaidaScore[]): { alvo: string | null; empate: boolean } {
  const cand = saidas.filter((s) => s.composite !== null).map((s) => ({ s, e: entradas.find((x) => x.resultado_id === s.resultado_id) as EntradaScore }));
  if (cand.length === 0) return { alvo: null, empate: false };
  cand.sort((a, b) => (b.s.composite as number) - (a.s.composite as number) || a.s.alvo.localeCompare(b.s.alvo));
  const topo = cand[0] as (typeof cand)[number];
  const proximos = cand.filter((c) => (topo.s.composite as number) - (c.s.composite as number) < EMPATE);
  if (proximos.length === 1) return { alvo: topo.s.alvo, empate: false };
  const ordenados = [...proximos].sort((a, b) => {
    const ca = a.e.custo_usd, cb = b.e.custo_usd;
    if (ca !== null && cb !== null && ca !== cb) return ca - cb;
    const ra = a.e.revisoes ?? 0, rb = b.e.revisoes ?? 0;
    if (ra !== rb) return ra - rb;
    return 0;
  });
  const a = ordenados[0] as (typeof ordenados)[number];
  const b = ordenados[1] as (typeof ordenados)[number];
  const igual = (a.e.custo_usd === b.e.custo_usd || a.e.custo_usd === null || b.e.custo_usd === null) && (a.e.revisoes ?? 0) === (b.e.revisoes ?? 0);
  if (igual) return { alvo: null, empate: true };
  return { alvo: a.s.alvo, empate: false };
}

/** Uma tarefa já com as métricas dos alvos comparados (uma por alvo). */
export interface TarefaParaComparar { tarefa: string; versao: number; atividade: string; entradas: EntradaScore[] }

const fmtNum = (x: number, d = 1): string => x.toFixed(d).replace(".", ",");

export function compararTarefas(alvos: readonly string[], tarefas: readonly TarefaParaComparar[], pesos: PesosScore = PESOS_PADRAO): Comparacao {
  const linhas: LinhaComparacao[] = [];
  const vitorias: Record<string, number> = Object.fromEntries(alvos.map((a) => [a, 0]));
  let empates = 0;
  const somaComp = new Map<string, number[]>();
  const somaCusto = new Map<string, number[]>();
  const somaDur = new Map<string, number[]>();
  let semCusto = false;
  let unico = false;
  for (const t of tarefas) {
    const saidas = pontuarTarefa(t.entradas, pesos);
    const v = vencedorDaTarefa(t.entradas, saidas);
    if (v.alvo !== null) vitorias[v.alvo] = (vitorias[v.alvo] ?? 0) + 1;
    else if (v.empate) empates++;
    if (saidas.some((s) => s.sem_custo)) semCusto = true;
    if (saidas.some((s) => s.nao_comparavel)) unico = true;
    const celulas: CelulaComparacao[] = alvos.map((alvo) => {
      const e = t.entradas.find((x) => x.alvo === alvo);
      const s = saidas.find((x) => x.alvo === alvo);
      if (e === undefined) return { alvo, resultado_id: null, estado: null, qualidade: null, custo_usd: null, duracao_s: null, tokens_out: null, composite: null, vencedor: false };
      if (s?.composite != null) push(somaComp, alvo, s.composite);
      if (e.custo_usd !== null) push(somaCusto, alvo, e.custo_usd);
      if (e.duracao_s !== null) push(somaDur, alvo, e.duracao_s);
      return { alvo, resultado_id: e.resultado_id, estado: (e.estado ?? null) as CelulaComparacao["estado"], qualidade: e.qualidade, custo_usd: e.custo_usd, duracao_s: e.duracao_s, tokens_out: e.tokens_out ?? null, composite: s?.composite ?? null, vencedor: v.alvo === alvo };
    });
    linhas.push({ tarefa: t.tarefa, versao: t.versao, atividade: t.atividade, celulas });
  }
  const media = (xs: number[] | undefined): number | null => (xs === undefined || xs.length === 0 ? null : arred(xs.reduce((a, b) => a + b, 0) / xs.length));
  const total = (xs: number[] | undefined): number | null => (xs === undefined || xs.length === 0 ? null : arred(xs.reduce((a, b) => a + b, 0)));
  const agregado: AgregadoAlvo[] = alvos.map((alvo) => ({
    alvo,
    composite_medio: media(somaComp.get(alvo)),
    // custo total só é honesto se TODAS as tarefas do alvo têm custo
    custo_total_usd: (somaCusto.get(alvo)?.length ?? 0) === linhas.filter((l) => l.celulas.some((c) => c.alvo === alvo && c.resultado_id !== null)).length ? total(somaCusto.get(alvo)) : null,
    duracao_media_s: media(somaDur.get(alvo)),
    vitorias: vitorias[alvo] ?? 0,
    tarefas: linhas.filter((l) => l.celulas.some((c) => c.alvo === alvo && c.resultado_id !== null)).length,
  }));
  const selos: SeloComparacao[] = [];
  if (semCusto) selos.push("sem_custo");
  if (unico) selos.push("nao_comparavel");
  return { alvos: [...alvos], linhas, placar: { vitorias, empates }, agregado, veredito: textoVeredito(agregado, linhas.length, empates, semCusto), selos };
}

function push(m: Map<string, number[]>, k: string, v: number): void {
  const l = m.get(k);
  if (l === undefined) m.set(k, [v]);
  else l.push(v);
}

/** Veredito por TEMPLATE com números (reprodutível, sem LLM). */
export function textoVeredito(agregado: readonly AgregadoAlvo[], tarefas: number, empates: number, semCusto: boolean): string {
  if (tarefas === 0) return "Sem tarefas comparáveis.";
  const ord = [...agregado].sort((a, b) => b.vitorias - a.vitorias || (b.composite_medio ?? -1) - (a.composite_medio ?? -1) || a.alvo.localeCompare(b.alvo));
  const [p, s] = ord;
  if (p === undefined) return "Sem alvos.";
  if (p.composite_medio === null) return "Nenhum alvo foi pontuado ainda: falta nota do juiz ou nota manual.";
  const cauda = semCusto ? " (sem custo: o score ignora o custo porque há alvo com custo desconhecido)" : "";
  if (s === undefined) return `${p.alvo}: score ${fmtNum(p.composite_medio)} em ${tarefas} tarefa(s); score não comparável com um alvo só.`;
  const empate = empates > 0 ? `, ${empates} empate(s)` : "";
  return `${p.alvo} venceu ${p.vitorias} de ${tarefas} tarefa(s) contra ${s.vitorias} de ${s.alvo}${empate}; score médio ${fmtNum(p.composite_medio)} contra ${s.composite_medio === null ? "sem nota" : fmtNum(s.composite_medio)}${cauda}.`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- recomendar

export interface MetaAlvo { provedor: string; modelo: string; esforco: string | null; cli: string }
export interface AmostraAtividade {
  atividade: string;
  tarefa: string;
  versao: number;
  entradas: EntradaScore[];
}
export interface OpcoesRecomendar {
  restricoes?: Restricoes | null;
  estrategia?: Estrategia | null;
  min_q?: number;
  min_amostras?: number;
  pesos?: PesosScore;
  /** ids de provedor/CLI habilitados COM conta (porta `PortaProvedores`); `null` = não filtrar. */
  provedores_habilitados?: ReadonlySet<string> | null;
}

/** Ranking por atividade: agrupa por alvo (média de composite, custo, duração, n); filtra por restrições e provedor habilitado; ordem estável (desempate por slug). */
export function recomendar(atividade: string, amostras: readonly AmostraAtividade[], meta: ReadonlyMap<string, MetaAlvo>, op: OpcoesRecomendar = {}): Recomendacao {
  const minAmostras = op.min_amostras ?? 1;
  const estrategia = op.estrategia ?? "melhor_qualidade";
  const minQ = op.min_q ?? 6;
  const acc = new Map<string, { comp: number[]; custo: number[]; dur: number[]; rev: number[]; q: number[]; ids: string[]; semCusto: boolean }>();
  for (const a of amostras) {
    if (a.atividade !== atividade) continue;
    const saidas = pontuarTarefa(a.entradas, op.pesos ?? PESOS_PADRAO);
    for (const s of saidas) {
      if (s.composite === null) continue;
      const e = a.entradas.find((x) => x.resultado_id === s.resultado_id) as EntradaScore;
      let g = acc.get(s.alvo);
      if (g === undefined) { g = { comp: [], custo: [], dur: [], rev: [], q: [], ids: [], semCusto: false }; acc.set(s.alvo, g); }
      g.comp.push(s.composite);
      if (e.custo_usd !== null) g.custo.push(e.custo_usd); else g.semCusto = true;
      if (e.duracao_s !== null) g.dur.push(e.duracao_s);
      g.rev.push(e.revisoes ?? 0);
      g.q.push((e.qualidade ?? 0));
      g.ids.push(e.resultado_id);
    }
  }
  const med = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((x, y) => x + y, 0) / xs.length);
  let itens: Array<ItemRecomendacao & { q: number }> = [];
  for (const [alvo, g] of acc) {
    const m = meta.get(alvo);
    if (m === undefined || g.comp.length < minAmostras) continue;
    // o id de provedor do harness é o id da CLI: a porta devolve os ids habilitados COM conta
    if (op.provedores_habilitados != null && !op.provedores_habilitados.has(m.cli)) continue;
    const custo = g.semCusto ? null : med(g.custo);
    const dur = med(g.dur);
    const r = op.restricoes;
    if (r?.provedores != null && !r.provedores.includes(m.provedor)) continue;
    if (r?.custo_max_usd != null && (custo === null || custo > r.custo_max_usd)) continue;
    if (r?.duracao_max_s != null && (dur === null || dur > r.duracao_max_s)) continue;
    itens.push({ alvo, provedor: m.provedor, modelo: m.modelo, esforco: m.esforco, cli: m.cli, composite: arred(med(g.comp) ?? 0), custo_usd: custo === null ? null : arred(custo), duracao_s: dur === null ? null : arred(dur), amostras: g.comp.length, tentativas_esperadas: arred(1 + (med(g.rev) ?? 0)), evidencia: g.ids, q: med(g.q) ?? 0 });
  }
  if (estrategia !== "melhor_qualidade") {
    const aceitaveis = itens.filter((i) => i.q >= minQ);
    itens = aceitaveis;
    const chave = estrategia === "mais_barato_aceitavel" ? (i: ItemRecomendacao) => i.custo_usd ?? Infinity : (i: ItemRecomendacao) => i.duracao_s ?? Infinity;
    itens.sort((a, b) => chave(a) - chave(b) || b.composite - a.composite || a.alvo.localeCompare(b.alvo));
  } else itens.sort((a, b) => b.composite - a.composite || a.alvo.localeCompare(b.alvo));
  return { atividade, sem_dados: itens.length === 0, ranking: itens.map(({ q: _q, ...resto }) => resto) };
}

/** Rascunho de política: transforma o ranking por atividade em `{task_type, executor, alternativas}`. NUNCA grava; atividade sem mapeamento sai com aviso. */
export function rascunhoDePolitica(recs: readonly Recomendacao[], maxAlternativas = 2): { rascunho: RascunhoPolitica[]; avisos: string[] } {
  const rascunho: RascunhoPolitica[] = [];
  const avisos: string[] = [];
  for (const r of recs) {
    if (r.sem_dados) { avisos.push(`Atividade "${r.atividade}": sem dados suficientes para sugerir.`); continue; }
    const tt = taskTypeDaAtividade(r.atividade);
    if (tt === null) { avisos.push(`Atividade "${r.atividade}": sem TaskType equivalente no harness; nada sugerido.`); continue; }
    const ex = (i: ItemRecomendacao) => ({ provider: i.cli, cli: i.cli, model: i.modelo, effort: i.esforco, faixa: null as null });
    const [topo, ...resto] = r.ranking;
    if (topo === undefined) continue;
    rascunho.push({ atividade: r.atividade, task_type: tt, executor: ex(topo), alternativas: resto.slice(0, maxAlternativas).map(ex), evidencia: topo.evidencia });
  }
  return { rascunho, avisos };
}
