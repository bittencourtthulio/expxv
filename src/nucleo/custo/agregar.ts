// Agregação e consultas de custo (T-10.09, T-10.25). PURO: transforma linhas materializadas (`custo_agregado`) em `CustoResumo`/`CustoMissao`/relatório, e
// calcula estimativas e previsões. Regras: `usd = soma(usd_conhecido)` se alguma linha tem preço, senão `null`; `incompleto` = há registro sem preço OU fonte ausente;
// `aproximado` = algum preço não confirmado/derivado; sem registros ⇒ `usd:null` com `registros:0` (nunca "0"); card descartado MANTÉM o custo.
import type { Atribuicao, CustoMissao, CustoResumo, CustoSprint, EstimativaCusto, PrevisaoMissao, PrevisaoPeriodo, Tokens } from "../../compartilhado/custo";
import { arredondarUsd, somarTokens, tokensZerados } from "./calcular";

/** Linha materializada (ou agrupada) de custo: uma por (modelo, atribuição, …). */
export interface LinhaAgregada {
  atribuicao: Atribuicao;
  /** `''` = modelo desconhecido. */
  modelo: string;
  registros: number;
  registros_sem_preco: number;
  registros_aproximados: number;
  tokens_entrada: number;
  tokens_cache_escrita: number;
  tokens_cache_leitura: number;
  tokens_saida: number;
  usd_conhecido: number;
}
export interface ExtrasResumo {
  fontes_ausentes?: readonly string[];
  atualizado_em?: string | null;
}

export const resumoVazio = (extras: ExtrasResumo = {}): CustoResumo => ({
  usd: null,
  incompleto: (extras.fontes_ausentes?.length ?? 0) > 0,
  aproximado: false,
  tokens: tokensZerados(),
  registros: 0,
  modelos: [],
  fontes_ausentes: [...(extras.fontes_ausentes ?? [])].sort(),
  atualizado_em: extras.atualizado_em ?? null,
});

export function tokensDaLinha(l: LinhaAgregada): Tokens {
  return { entrada: l.tokens_entrada, cache_escrita: l.tokens_cache_escrita, cache_leitura: l.tokens_cache_leitura, saida: l.tokens_saida };
}

export function resumir(linhas: readonly LinhaAgregada[], extras: ExtrasResumo = {}): CustoResumo {
  let registros = 0;
  let semPreco = 0;
  let aprox = 0;
  let usd = 0;
  let tokens = tokensZerados();
  const modelos = new Set<string>();
  for (const l of linhas) {
    if (l.registros <= 0 && l.tokens_entrada + l.tokens_saida + l.tokens_cache_escrita + l.tokens_cache_leitura === 0) continue; // linha zerada por reatribuição
    registros += l.registros;
    semPreco += l.registros_sem_preco;
    aprox += l.registros_aproximados;
    usd += l.usd_conhecido;
    tokens = somarTokens(tokens, tokensDaLinha(l));
    if (l.modelo !== "") modelos.add(l.modelo);
  }
  const ausentes = [...(extras.fontes_ausentes ?? [])].sort();
  const algumPreco = registros > semPreco;
  return {
    usd: algumPreco ? arredondarUsd(usd) : null,
    incompleto: semPreco > 0 || ausentes.length > 0,
    aproximado: aprox > 0,
    tokens,
    registros,
    modelos: [...modelos].sort(),
    fontes_ausentes: ausentes,
    atualizado_em: extras.atualizado_em ?? null,
  };
}

/** `CustoMissao`: total + separação `orquestracao/cards/sem_card/ambiguo`. Σ das quatro partes = total (os registros são disjuntos por atribuição). */
export function resumirMissao(linhas: readonly LinhaAgregada[], extras: ExtrasResumo = {}): CustoMissao {
  const por = (a: Atribuicao): CustoResumo => resumir(linhas.filter((l) => l.atribuicao === a), { atualizado_em: extras.atualizado_em ?? null });
  return { ...resumir(linhas, extras), orquestracao: por("orquestracao"), cards: por("card"), sem_card: por("sem_card"), ambiguo: por("ambigua") };
}

/** Soma resumos de partes (ex.: cards de uma sprint). `usd:null` só se NENHUMA parte tem preço; incompleto se qualquer parte é incompleta ou sem dado. */
export function somarResumos(partes: readonly CustoResumo[]): CustoResumo {
  let usd: number | null = null;
  let tokens = tokensZerados();
  let registros = 0;
  const modelos = new Set<string>();
  const ausentes = new Set<string>();
  let incompleto = false;
  let aproximado = false;
  let atualizado: string | null = null;
  for (const p of partes) {
    if (p.usd !== null) usd = (usd ?? 0) + p.usd;
    tokens = somarTokens(tokens, p.tokens);
    registros += p.registros;
    p.modelos.forEach((m) => modelos.add(m));
    p.fontes_ausentes.forEach((f) => ausentes.add(f));
    incompleto ||= p.incompleto;
    aproximado ||= p.aproximado;
    if (p.atualizado_em !== null && (atualizado === null || p.atualizado_em > atualizado)) atualizado = p.atualizado_em;
  }
  return { usd: usd === null ? null : arredondarUsd(usd), incompleto, aproximado, tokens, registros, modelos: [...modelos].sort(), fontes_ausentes: [...ausentes].sort(), atualizado_em: atualizado };
}

// ------------------------------------------------------------------ estimativa histórica (T-10.25)
function percentil(ordenado: readonly number[], p: number): number {
  if (ordenado.length === 1) return ordenado[0] as number;
  const pos = (ordenado.length - 1) * p;
  const baixo = Math.floor(pos);
  const alto = Math.ceil(pos);
  return (ordenado[baixo] as number) + ((ordenado[alto] as number) - (ordenado[baixo] as number)) * (pos - baixo);
}
export const AMOSTRAS_MINIMAS = 3;
/** Mediana/p25/p75 de cards CONCLUÍDOS e COMPLETOS (o chamador filtra). `< 3` amostras ⇒ `sem_historico` (nunca chuta). A estimativa NÃO é custo do card. */
export function estimar(amostrasUsd: readonly number[]): EstimativaCusto {
  const v = amostrasUsd.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (v.length < AMOSTRAS_MINIMAS) return { mediana_usd: null, p25_usd: null, p75_usd: null, amostras: v.length, confianca: "sem_historico" };
  return {
    mediana_usd: arredondarUsd(percentil(v, 0.5)),
    p25_usd: arredondarUsd(percentil(v, 0.25)),
    p75_usd: arredondarUsd(percentil(v, 0.75)),
    amostras: v.length,
    confianca: v.length >= 20 ? "alta" : v.length >= 8 ? "media" : "baixa",
  };
}
/** Amostras úteis a partir dos custos dos cards concluídos: só os completos (`incompleto:false`) e com valor. */
export function amostrasCompletas(custos: ReadonlyArray<{ usd: number | null; incompleto: boolean }>): number[] {
  return custos.filter((c) => !c.incompleto && c.usd !== null).map((c) => c.usd as number);
}

// ------------------------------------------------------------------ previsões
/**
 * Previsão do custo total de uma Missão. Base `historico` (≥ 3 amostras): restante = cards restantes × mediana. Senão, base `ritmo`: custo atual ÷ cards concluídos × restantes
 * (só com ≥ 1 card concluído com custo). Sem nenhuma base ⇒ `sem_base` e números `null` (nunca chuta).
 */
export function preverCustoMissao(e: { custo_atual: CustoResumo; cards_restantes: number; cards_concluidos: number; estimativa: EstimativaCusto }): PrevisaoMissao {
  const atual = e.custo_atual.usd;
  const base = { custo_atual_usd: atual, cards_restantes: e.cards_restantes, amostras: e.estimativa.amostras, incompleto: e.custo_atual.incompleto };
  if (e.cards_restantes === 0) return { ...base, restante_estimado_usd: 0, total_projetado_usd: atual, base: atual === null ? "sem_base" : "historico" };
  if (e.estimativa.mediana_usd !== null) {
    const restante = arredondarUsd(e.estimativa.mediana_usd * e.cards_restantes);
    return { ...base, restante_estimado_usd: restante, total_projetado_usd: arredondarUsd((atual ?? 0) + restante), base: "historico" };
  }
  if (atual !== null && e.cards_concluidos > 0) {
    const restante = arredondarUsd((atual / e.cards_concluidos) * e.cards_restantes);
    return { ...base, restante_estimado_usd: restante, total_projetado_usd: arredondarUsd(atual + restante), base: "ritmo", incompleto: true };
  }
  return { ...base, restante_estimado_usd: null, total_projetado_usd: null, base: "sem_base" };
}

const DIA_MS = 86_400_000;
/** Projeção de um período (mês, sprint): ritmo = média diária dos últimos `janelaDias` com dado; projeta até `fim`. Sem dias com gasto ⇒ `sem_base`. */
export function preverPeriodo(e: { serie: ReadonlyArray<{ dia: string; usd: number }>; inicio: string; fim: string; hoje: string; janelaDias?: number }): PrevisaoPeriodo {
  const inicio = Date.parse(`${e.inicio.slice(0, 10)}T00:00:00Z`);
  const fim = Date.parse(`${e.fim.slice(0, 10)}T00:00:00Z`);
  const hoje = Date.parse(`${e.hoje.slice(0, 10)}T00:00:00Z`);
  const decorridos = Math.max(0, Math.min(Math.round((hoje - inicio) / DIA_MS) + 1, Math.round((fim - inicio) / DIA_MS) + 1));
  const restantes = Math.max(0, Math.round((fim - hoje) / DIA_MS));
  const noPeriodo = e.serie.filter((s) => s.dia >= e.inicio.slice(0, 10) && s.dia <= e.hoje.slice(0, 10));
  const gasto = noPeriodo.length === 0 ? null : arredondarUsd(noPeriodo.reduce((a, s) => a + s.usd, 0));
  if (gasto === null || decorridos === 0) return { gasto_usd: gasto, media_diaria_usd: null, projecao_fim_periodo_usd: null, dias_decorridos: decorridos, dias_restantes: restantes, base: "sem_base" };
  const janela = Math.max(1, e.janelaDias ?? 7);
  const corte = new Date(hoje - (janela - 1) * DIA_MS).toISOString().slice(0, 10);
  const recentes = noPeriodo.filter((s) => s.dia >= corte);
  const diasJanela = Math.min(janela, decorridos);
  const media = arredondarUsd(recentes.reduce((a, s) => a + s.usd, 0) / diasJanela);
  return { gasto_usd: gasto, media_diaria_usd: media, projecao_fim_periodo_usd: arredondarUsd(gasto + media * restantes), dias_decorridos: decorridos, dias_restantes: restantes, base: "ritmo" };
}

/** Custo de uma sprint = soma dos custos dos cards dos itens vinculados (`trabalho_id`+`task_ref`). Item sem vínculo/sem custo conta em `itens_sem_custo` e torna a soma incompleta. */
export function custoDaSprint(sprintId: string, itens: ReadonlyArray<{ chave_card: string | null }>, custoDoCard: (chave: string) => CustoResumo | null): CustoSprint {
  const partes: CustoResumo[] = [];
  let semCusto = 0;
  for (const i of itens) {
    const c = i.chave_card === null ? null : custoDoCard(i.chave_card);
    if (c === null || c.registros === 0) semCusto++;
    else partes.push(c);
  }
  const soma = somarResumos(partes);
  return { sprint_id: sprintId, custo: semCusto > 0 ? { ...soma, incompleto: true } : soma, itens: itens.length, itens_sem_custo: semCusto };
}
