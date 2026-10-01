// Semente de política (T-09.10): task_type → executor por FAIXA (sem nome de modelo), alternativas e fallback.
// Pura e determinística: depende só dos provedores existentes/preferidos e da tabela de equivalência recebida.
import type { EntradaEquivalencia, Executor, Faixa, PoliticaEntrada, TaskTypeEntrada } from "../../compartilhado/harness";
import { PROVEDOR_OPENROUTER, resolverFaixa } from "./equivalencia";
import { FAIXA_PADRAO_POR_TASK_TYPE, OUTRO_PROVEDOR_QUE, TASK_TYPES_EMBUTIDOS } from "./task-types";

const executorDe = (provedor: string, faixa: Faixa): Executor => ({ provider: provedor, cli: provedor === PROVEDOR_OPENROUTER ? null : provedor, model: null, effort: null, faixa });

/** Provedores habilitados na ordem de preferência: `preferencia` ∩ `catalogo`, depois o resto do catálogo (openrouter por último). */
export function ordenarProvedores(catalogo: readonly string[], preferencia: readonly string[]): string[] {
  const existentes = new Set(catalogo);
  const ordem = preferencia.filter((p, i) => existentes.has(p) && preferencia.indexOf(p) === i);
  const resto = catalogo.filter((p) => !ordem.includes(p));
  return [...ordem, ...resto.filter((p) => p !== PROVEDOR_OPENROUTER), ...resto.filter((p) => p === PROVEDOR_OPENROUTER)];
}

/**
 * `gerarSemente(catalogo, preferencia, equivalencia)`: uma política GLOBAL por tipo embutido.
 * - executor = primeiro provedor (na preferência) com a faixa do tipo preenchida; faixa vazia pula o provedor;
 *   se nenhum tem a faixa, usa a faixa mais próxima disponível;
 * - alternativas = os demais provedores com a mesma faixa;
 * - fallback = faixa `topo` do primeiro provedor habilitado (nunca vazio; vazio só se não há provedor com nenhum modelo);
 * - `auditar` escolhe provedor diferente do de `implementar` quando há ≥ 2 provedores aptos.
 */
export function gerarSemente(catalogo: readonly string[], preferencia: readonly string[], equivalencia: EntradaEquivalencia, tipos: readonly TaskTypeEntrada[] = TASK_TYPES_EMBUTIDOS): PoliticaEntrada[] {
  const provedores = ordenarProvedores(catalogo, preferencia);
  const desc = equivalencia.ordem_de_descida;
  const aptos = (f: Faixa): string[] => provedores.filter((p) => resolverFaixa(equivalencia, p, f).length > 0);
  const faixaEfetiva = (f: Faixa): Faixa | null => {
    const i = desc.indexOf(f);
    for (const c of [...desc.slice(i), ...desc.slice(0, i).reverse()]) if (aptos(c).length > 0) return c;
    return null;
  };
  const faixaFallback = faixaEfetiva("topo");
  if (faixaFallback === null) return [];
  const provedorFallback = aptos(faixaFallback)[0] as string;
  const fallback = [executorDe(provedorFallback, faixaFallback)];

  const escolhido = new Map<string, string>(); // slug → provedor do executor
  const ordemDeProcessamento = [...tipos].sort((a, b) => Number(a.slug in OUTRO_PROVEDOR_QUE) - Number(b.slug in OUTRO_PROVEDOR_QUE));
  const saida = new Map<string, PoliticaEntrada>();
  for (const t of ordemDeProcessamento) {
    const alvo = FAIXA_PADRAO_POR_TASK_TYPE[t.slug] ?? "alto";
    const faixa = faixaEfetiva(alvo);
    if (faixa === null) continue;
    let candidatos = aptos(faixa);
    const referencia = OUTRO_PROVEDOR_QUE[t.slug];
    const evitar = referencia === undefined ? undefined : escolhido.get(referencia);
    if (evitar !== undefined && candidatos.some((p) => p !== evitar)) candidatos = [...candidatos.filter((p) => p !== evitar), ...candidatos.filter((p) => p === evitar)];
    const [primeiro, ...outros] = candidatos as [string, ...string[]];
    escolhido.set(t.slug, primeiro);
    saida.set(t.slug, {
      workspace_id: null,
      task_type: t.slug,
      executor: executorDe(primeiro, faixa),
      alternativas: outros.map((p) => executorDe(p, faixa)),
      fallback: fallback.map((e) => ({ ...e })),
      skills: [],
      agente: null,
      conta_fixa_id: null,
      evitar_reservadas: true,
      habilitada: true,
    });
  }
  return tipos.map((t) => saida.get(t.slug)).filter((p): p is PoliticaEntrada => p !== undefined);
}
