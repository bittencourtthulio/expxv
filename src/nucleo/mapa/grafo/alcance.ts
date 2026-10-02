import type { GrafoMemoria } from "./memoria";

export type DirecaoAlcance = "saida" | "entrada";

export interface OpcoesAlcance {
  direcao?: DirecaoAlcance;
  /** Profundidade máxima (padrão: sem limite). */
  profundidade?: number;
  /** Teto de nós visitados (sem contar as origens). */
  maxNos?: number;
  minConfianca?: "exata" | "heuristica";
}

export interface ResultadoAlcance {
  /** Nós alcançados (sem as origens), na ordem da busca em largura. */
  nos: Int32Array;
  /** Distância (arestas) de cada nó de `nos`. */
  distancia: Int32Array;
  truncado: boolean;
}

function vizinhos(g: GrafoMemoria, direcao: DirecaoAlcance): { off: Int32Array; dst: Int32Array; exata: Uint8Array } {
  return direcao === "saida" ? { off: g.saidaOff, dst: g.saidaDst, exata: g.saidaExata } : { off: g.entradaOff, dst: g.entradaSrc, exata: g.entradaExata };
}

/** BFS direta (`saida`) ou reversa (`entrada`) a partir de uma ou mais origens, com limite de profundidade e de nós. */
export function alcance(g: GrafoMemoria, origens: number | readonly number[], opcoes: OpcoesAlcance = {}): ResultadoAlcance {
  const { off, dst, exata } = vizinhos(g, opcoes.direcao ?? "saida");
  const maxProf = opcoes.profundidade ?? Infinity;
  const maxNos = opcoes.maxNos ?? Infinity;
  const so = opcoes.minConfianca === "exata";
  const dist = new Int32Array(g.n).fill(-1);
  const fila: number[] = [];
  for (const o of Array.isArray(origens) ? (origens as readonly number[]) : [origens as number]) {
    if (o >= 0 && o < g.n && dist[o] === -1) {
      dist[o] = 0;
      fila.push(o);
    }
  }
  const nOrigens = fila.length;
  let truncado = false;
  for (let h = 0; h < fila.length && !truncado; h++) {
    const v = fila[h]!;
    if (dist[v]! >= maxProf) continue;
    for (let k = off[v]!; k < off[v + 1]!; k++) {
      if (so && exata[k] === 0) continue;
      const w = dst[k]!;
      if (dist[w] !== -1) continue;
      if (fila.length - nOrigens >= maxNos) {
        truncado = true;
        break;
      }
      dist[w] = dist[v]! + 1;
      fila.push(w);
    }
  }
  const nos = Int32Array.from(fila.slice(nOrigens));
  return { nos, distancia: Int32Array.from(nos, (v) => dist[v]!), truncado };
}

/** Caminho mínimo (em arestas) de `origem` a `alvo`; `null` se não houver. Inclui as pontas. */
export function caminhoMinimo(g: GrafoMemoria, origem: number, alvo: number, opcoes: Pick<OpcoesAlcance, "direcao" | "minConfianca"> = {}): number[] | null {
  if (origem < 0 || alvo < 0 || origem >= g.n || alvo >= g.n) return null;
  if (origem === alvo) return [origem];
  const { off, dst, exata } = vizinhos(g, opcoes.direcao ?? "saida");
  const so = opcoes.minConfianca === "exata";
  const pai = new Int32Array(g.n).fill(-2);
  pai[origem] = -1;
  const fila = [origem];
  for (let h = 0; h < fila.length; h++) {
    const v = fila[h]!;
    for (let k = off[v]!; k < off[v + 1]!; k++) {
      if (so && exata[k] === 0) continue;
      const w = dst[k]!;
      if (pai[w] !== -2) continue;
      pai[w] = v;
      if (w === alvo) {
        const c = [w];
        for (let p = v; p !== -1; p = pai[p]!) c.push(p);
        return c.reverse();
      }
      fila.push(w);
    }
  }
  return null;
}

/**
 * Candidatos a costura: nós (fora entradas e alvo) presentes no caminho mínimo de TODAS as entradas que alcançam o alvo.
 * Ordenados pelo menor número de saltos até o alvo.
 */
export function candidatosCostura(g: GrafoMemoria, entradas: readonly number[], alvo: number): number[] {
  let comum: Set<number> | null = null;
  let ordem = new Map<number, number>();
  for (const e of entradas) {
    const c = caminhoMinimo(g, e, alvo);
    if (c === null) continue;
    const meio = new Set(c.slice(1, -1));
    if (comum === null) {
      comum = meio;
      c.forEach((v, i) => ordem.set(v, c.length - i));
    } else {
      for (const v of [...comum]) if (!meio.has(v)) comum.delete(v);
    }
  }
  if (comum === null) return [];
  const ent = new Set(entradas);
  return [...comum].filter((v) => !ent.has(v) && v !== alvo).sort((a, b) => (ordem.get(a) ?? 0) - (ordem.get(b) ?? 0) || a - b);
}
