// Consultas derivadas (T-12.18/T-12.19/T-12.24): comparar, recomendar e relatório, calculadas SOBRE as métricas brutas do banco (nada disso é gravado). Sem I/O: recebe linhas e devolve estruturas.
import { criticaFalhou } from "./medicao/checagens";
import { compararTarefas, recomendar as recomendarPuro, rascunhoDePolitica, type AmostraAtividade, type EntradaScore, type MetaAlvo, type TarefaParaComparar } from "./score";
import { limpar } from "./redacao";
import { PESOS_PADRAO, type AlvoBench, type Comparacao, type Estrategia, type GradeRun, type LinhaResultado, type PesosScore, type RascunhoPolitica, type Recomendacao, type Restricoes, type SeloComparacao, type TarefaBench } from "./tipos";

const FINAIS: ReadonlySet<string> = new Set(["concluido", "falhou", "tempo_esgotado"]);

export const entradaDe = (r: LinhaResultado): EntradaScore => ({ resultado_id: r.id, alvo: r.alvo_slug, qualidade: r.qualidade, duracao_s: r.duracao_s, custo_usd: r.custo_usd, critica_falhou: criticaFalhou(r.checagens), revisoes: r.revisoes, tokens_out: r.tokens_out, estado: r.estado });

/** Último resultado (por `criado_em`) de cada (tarefa, versão, alvo); só estados finais com dado. `historico` vem do mais novo para o mais antigo. */
export function vigentesPorChave(historico: readonly LinhaResultado[]): Map<string, LinhaResultado> {
  const m = new Map<string, LinhaResultado>();
  for (const r of historico) {
    if (!FINAIS.has(r.estado)) continue;
    const k = `${r.tarefa_slug}\u0000${r.tarefa_versao}\u0000${r.alvo_slug}`;
    if (!m.has(k)) m.set(k, r);
  }
  return m;
}

export interface OpcoesComparar { tarefas: readonly string[] | null; agrupar: "tarefa" | "atividade"; pesos?: PesosScore; tarefasMeta: ReadonlyMap<string, Pick<TarefaBench, "atividade">> }

export function compararHistorico(alvos: readonly string[], historico: readonly LinhaResultado[], op: OpcoesComparar): Comparacao | { erro: "nao_comparavel"; diferencas: string[] } {
  if (new Set(alvos).size < 2) return { erro: "nao_comparavel", diferencas: ["é preciso ao menos 2 alvos distintos"] };
  const vig = vigentesPorChave(historico.filter((r) => alvos.includes(r.alvo_slug)));
  const porTarefa = new Map<string, Map<number, Map<string, LinhaResultado>>>();
  for (const r of vig.values()) {
    if (op.tarefas !== null && !op.tarefas.includes(r.tarefa_slug)) continue;
    let v = porTarefa.get(r.tarefa_slug);
    if (v === undefined) { v = new Map(); porTarefa.set(r.tarefa_slug, v); }
    let a = v.get(r.tarefa_versao);
    if (a === undefined) { a = new Map(); v.set(r.tarefa_versao, a); }
    a.set(r.alvo_slug, r);
  }
  const lista: TarefaParaComparar[] = [];
  const diferencas: string[] = [];
  for (const [tarefa, versoes] of [...porTarefa].sort((x, y) => x[0].localeCompare(y[0]))) {
    const comuns = [...versoes].filter(([, porAlvo]) => alvos.every((a) => porAlvo.has(a))).map(([v]) => v).sort((a, b) => b - a);
    if (comuns.length === 0) { diferencas.push(`${tarefa}: alvos com versões diferentes da tarefa (${[...versoes.keys()].sort().join(", ")})`); continue; }
    const versao = comuns[0] as number;
    const porAlvo = versoes.get(versao) as Map<string, LinhaResultado>;
    lista.push({ tarefa, versao, atividade: op.tarefasMeta.get(tarefa)?.atividade ?? "desconhecida", entradas: alvos.map((a) => entradaDe(porAlvo.get(a) as LinhaResultado)) });
  }
  if (lista.length === 0) return { erro: "nao_comparavel", diferencas: diferencas.length > 0 ? diferencas : ["nenhuma tarefa com resultado de todos os alvos"] };
  let c = compararTarefas(alvos, lista, op.pesos ?? PESOS_PADRAO);
  const selos: SeloComparacao[] = [...c.selos];
  if (diferencas.length > 0) selos.push("versoes_diferentes");
  const parcial = [...vig.values()].some((r) => alvos.includes(r.alvo_slug) && r.isolamento === "parcial" && lista.some((t) => t.tarefa === r.tarefa_slug && t.versao === r.tarefa_versao));
  if (parcial) selos.push("harness_parcial");
  c = { ...c, selos };
  return op.agrupar === "atividade" ? agruparPorAtividade(c) : c;
}

function agruparPorAtividade(c: Comparacao): Comparacao {
  const grupos = new Map<string, typeof c.linhas>();
  for (const l of c.linhas) grupos.set(l.atividade, [...(grupos.get(l.atividade) ?? []), l]);
  const media = (xs: Array<number | null>): number | null => { const v = xs.filter((x): x is number => x !== null); return v.length === 0 ? null : Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000; };
  const linhas = [...grupos].map(([atividade, ls]) => ({
    tarefa: atividade, versao: 0, atividade,
    celulas: c.alvos.map((alvo) => {
      const cs = ls.map((l) => l.celulas.find((x) => x.alvo === alvo)).filter((x) => x !== undefined);
      return { alvo, resultado_id: null, estado: null, qualidade: media(cs.map((x) => x.qualidade)), custo_usd: cs.some((x) => x.custo_usd === null) ? null : media(cs.map((x) => x.custo_usd)), duracao_s: media(cs.map((x) => x.duracao_s)), tokens_out: media(cs.map((x) => x.tokens_out)), composite: media(cs.map((x) => x.composite)), vencedor: false };
    }),
  }));
  for (const l of linhas) {
    const topo = Math.max(...l.celulas.map((x) => x.composite ?? -1));
    l.celulas.forEach((x) => { x.vencedor = topo >= 0 && x.composite === topo; });
  }
  return { ...c, linhas };
}

export interface OpcoesRecomendarHistorico { restricoes: Restricoes | null; estrategia: Estrategia | null; habilitados: ReadonlySet<string> | null; pesos?: PesosScore; minAmostras?: number; minQ?: number }

/** Recomenda por atividade: pontua cada tarefa da atividade entre TODOS os alvos que a executaram na versão mais recente. */
export function recomendarHistorico(atividade: string, historico: readonly LinhaResultado[], tarefas: readonly TarefaBench[], alvos: readonly AlvoBench[], op: OpcoesRecomendarHistorico): Recomendacao {
  const daAtividade = tarefas.filter((t) => t.atividade === atividade);
  const vig = vigentesPorChave(historico);
  const amostras: AmostraAtividade[] = [];
  for (const t of daAtividade) {
    const porVersao = new Map<number, LinhaResultado[]>();
    for (const r of vig.values()) if (r.tarefa_slug === t.slug && r.qualidade !== null) porVersao.set(r.tarefa_versao, [...(porVersao.get(r.tarefa_versao) ?? []), r]);
    const versao = [...porVersao.keys()].sort((a, b) => b - a)[0];
    if (versao === undefined) continue;
    amostras.push({ atividade, tarefa: t.slug, versao, entradas: (porVersao.get(versao) as LinhaResultado[]).sort((a, b) => a.alvo_slug.localeCompare(b.alvo_slug)).map(entradaDe) });
  }
  const meta = new Map<string, MetaAlvo>(alvos.map((a) => [a.slug, { provedor: a.provedor, modelo: a.modelo, esforco: a.esforco, cli: a.cli }]));
  return recomendarPuro(atividade, amostras, meta, { restricoes: op.restricoes, estrategia: op.estrategia, provedores_habilitados: op.habilitados, ...(op.pesos === undefined ? {} : { pesos: op.pesos }), ...(op.minAmostras === undefined ? {} : { min_amostras: op.minAmostras }), ...(op.minQ === undefined ? {} : { min_q: op.minQ }) });
}

export function rascunhoDasAtividades(recs: readonly Recomendacao[]): { rascunho: RascunhoPolitica[]; avisos: string[] } {
  const r = rascunhoDePolitica(recs);
  return { rascunho: r.rascunho, avisos: ["Rascunho: nada foi gravado. Aplicar ao harness exige confirmação sua.", ...r.avisos] };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- relatório

const brl = (x: number | null): string => (x === null ? "custo desconhecido" : `US$ ${x.toFixed(4).replace(".", ",")}`);
const seg = (x: number | null): string => (x === null ? "?" : `${x.toFixed(1).replace(".", ",")} s`);

/** Relatório local de Runs (`md` ou `json`): sem caminho absoluto, sem segredo, sem `mapa_cego` e sem prompt privado (só o título da tarefa). */
export function montarRelatorio(grades: readonly GradeRun[], formato: "md" | "json", scrub?: (t: string) => string): string {
  if (formato === "json") {
    const saida = grades.map((g) => ({ run: { id: g.run.id, nome: g.run.nome, estado: g.run.estado, sandbox: g.run.sandbox, pesos: g.run.pesos, tarefas: g.run.tarefas }, resultados: g.resultados.map((r) => ({ tarefa: r.tarefa, versao: r.tarefa_versao, alvo: r.alvo, tentativa: r.tentativa, estado: r.estado, duracao_s: r.duracao_s, custo_usd: r.custo_usd, custo_fonte: r.custo_fonte, tokens_out: r.tokens_out, qualidade: r.qualidade })) }));
    return limpar(JSON.stringify({ gerado_por: "bench", runs: saida }, null, 2), scrub);
  }
  const l: string[] = ["# Relatório do Bench", ""];
  for (const g of grades) {
    l.push(`## ${g.run.nome} (${g.run.estado})`, "", `Sandbox: ${g.run.sandbox}. Pesos: qualidade ${g.run.pesos.q}, tempo ${g.run.pesos.s}, custo ${g.run.pesos.c}.`, "", "| Tarefa | Alvo | Estado | Duração | Custo | Nota |", "|---|---|---|---|---|---|");
    for (const r of g.resultados) l.push(`| ${r.tarefa} v${r.tarefa_versao} | ${r.alvo} | ${r.estado} | ${seg(r.duracao_s)} | ${brl(r.custo_usd)} | ${r.qualidade === null ? "sem nota" : r.qualidade.toFixed(1).replace(".", ",")} |`);
    l.push("");
  }
  return limpar(l.join("\n"), scrub);
}
