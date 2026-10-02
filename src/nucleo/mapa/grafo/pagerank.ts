import type { GrafoMemoria } from "./memoria";

export interface OpcoesPageRank {
  amortecimento?: number;
  iteracoes?: number;
  tolerancia?: number;
  /** Personalização: índice do nó → peso (normalizado). Ausente = uniforme. */
  personalizacao?: ReadonlyMap<number, number>;
}

/** PageRank (amortecimento 0,85, 50 iterações, tolerância 1e-6). Importância = quem é muito referenciado. A soma é 1. */
export function pageRank(g: GrafoMemoria, opcoes: OpcoesPageRank = {}): Float64Array {
  const n = g.n;
  const d = opcoes.amortecimento ?? 0.85;
  const maxIt = opcoes.iteracoes ?? 50;
  const tol = opcoes.tolerancia ?? 1e-6;
  let r = new Float64Array(n);
  if (n === 0) return r;
  const tele = new Float64Array(n);
  let soma = 0;
  if (opcoes.personalizacao !== undefined) for (const [i, p] of opcoes.personalizacao) if (i >= 0 && i < n && p > 0) soma += p;
  if (soma > 0 && opcoes.personalizacao !== undefined) {
    for (const [i, p] of opcoes.personalizacao) if (i >= 0 && i < n && p > 0) tele[i] = p / soma;
  } else tele.fill(1 / n);
  r.set(tele);
  let prox = new Float64Array(n);
  const peso = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    let s = 0;
    for (let k = g.saidaOff[v]!; k < g.saidaOff[v + 1]!; k++) s += g.saidaPeso[k]!;
    peso[v] = s;
  }
  for (let it = 0; it < maxIt; it++) {
    let pendente = 0; // massa dos nós sem saída: redistribuída pela teleportação
    for (let v = 0; v < n; v++) if (peso[v] === 0) pendente += r[v]!;
    for (let v = 0; v < n; v++) prox[v] = (1 - d + d * pendente) * tele[v]!;
    for (let v = 0; v < n; v++) {
      if (peso[v] === 0) continue;
      const parte = (d * r[v]!) / peso[v]!;
      for (let k = g.saidaOff[v]!; k < g.saidaOff[v + 1]!; k++) prox[g.saidaDst[k]!]! += parte * g.saidaPeso[k]!;
    }
    let delta = 0;
    for (let v = 0; v < n; v++) delta += Math.abs(prox[v]! - r[v]!);
    const t = r;
    r = prox;
    prox = t;
    if (delta < tol) break;
  }
  return r;
}
