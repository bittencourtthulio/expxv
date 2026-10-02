// T-18.18: erro de estimativa. razao = observado_ms / (pontos × ref_ms_por_ponto). Categoria com < 5 amostras => razao null. Reabertura NÃO duplica linha.
import type { ErroEstimativaAgregado, ErroEstimativaCategoria } from "../../../compartilhado/agil";
import type { BancoAgil, ErroEstimativaRegistro } from "../repos";
import { isoDe, mediana } from "../util";
import { refMsPorPonto } from "./calibracao";

export interface AmostraErro { item_id: string; estimativa_id: string; pontos: number; categoria: string | null; observado_ms: number | null; real_h: number | null }

export function calcularRazoes(amostras: readonly AmostraErro[], minimo = 5): ErroEstimativaRegistro[] {
  const ref = amostras.map((a) => ({ categoria: a.categoria, pontos: a.pontos, duracao_obs_ms: a.observado_ms }));
  const cache = new Map<string | null, number | null>();
  const refDe = (c: string | null): number | null => {
    if (!cache.has(c)) cache.set(c, refMsPorPonto(ref, c, minimo).ms_por_ponto);
    return cache.get(c) ?? null;
  };
  return amostras.map((a) => {
    const r = refDe(a.categoria);
    const razao = a.observado_ms !== null && r !== null && a.pontos > 0 ? a.observado_ms / (a.pontos * r) : null;
    return { item_id: a.item_id, estimativa_id: a.estimativa_id, pontos_previstos: a.pontos, categoria: a.categoria, observado_ms: a.observado_ms, real_h: a.real_h, ref_ms_por_ponto: r, razao, registrado_em: "" };
  });
}

export function agregarErro(linhas: readonly ErroEstimativaRegistro[]): ErroEstimativaAgregado {
  const por = new Map<string, number[]>();
  for (const l of linhas) if (l.razao !== null) (por.get(l.categoria ?? "sem_categoria") ?? por.set(l.categoria ?? "sem_categoria", []).get(l.categoria ?? "sem_categoria"))?.push(l.razao);
  const por_categoria: ErroEstimativaCategoria[] = [...por.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([categoria, rs]) => ({
    categoria, n: rs.length, vies: mediana(rs), mdape: mediana(rs.map((r) => Math.abs(r - 1))),
  }));
  const todas = [...por.values()].flat();
  return {
    por_categoria,
    pontos: linhas.map((l) => ({ item_id: l.item_id, previsto: l.pontos_previstos, observado_ms: l.observado_ms ?? 0, razao: l.razao })).filter((p) => p.observado_ms > 0),
    vies: todas.length ? mediana(todas) : null,
    mdape: todas.length ? mediana(todas.map((r) => Math.abs(r - 1))) : null,
  };
}

/** grava a linha do item ao detectar `concluida`; se já existe (reabertura), mantém a original. Devolve se gravou. */
export function registrarErro(banco: BancoAgil, a: AmostraErro, relogio: () => number): boolean {
  if (banco.erros.get(a.item_id)) return false;
  banco.erros.set(a.item_id, { item_id: a.item_id, estimativa_id: a.estimativa_id, pontos_previstos: a.pontos, categoria: a.categoria, observado_ms: a.observado_ms, real_h: a.real_h, ref_ms_por_ponto: null, razao: null, registrado_em: isoDe(relogio()) });
  return true;
}

/**
 * recalcula razão/ref das linhas com as amostras vigentes (calibração da próxima estimativa). `doEscopo` limita às linhas de UM workspace: a calibração de um workspace
 * nunca mistura amostras de outro. Só regrava a linha que mudou (a sincronização não reescreve milhares de linhas à toa). Devolve quantas mudaram.
 */
export function recalcularErros(banco: BancoAgil, minimo = 5, doEscopo: (itemId: string) => boolean = () => true): number {
  const linhas = banco.erros.valores().filter((l) => doEscopo(l.item_id));
  const novas = calcularRazoes(linhas.map((l) => ({ item_id: l.item_id, estimativa_id: l.estimativa_id, pontos: l.pontos_previstos, categoria: l.categoria, observado_ms: l.observado_ms, real_h: l.real_h })), minimo);
  let mudou = 0;
  banco.transacao(() => {
    novas.forEach((n, i) => {
      const antes = linhas[i] as ErroEstimativaRegistro;
      if (antes.razao === n.razao && antes.ref_ms_por_ponto === n.ref_ms_por_ponto) return;
      banco.erros.set(n.item_id, { ...n, registrado_em: antes.registrado_em });
      mudou++;
    });
  });
  return mudou;
}
