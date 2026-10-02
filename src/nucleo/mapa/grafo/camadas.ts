import { componentesFortes, type ComponentesFortes } from "./ciclos";
import type { GrafoMemoria } from "./memoria";

// Níveis topológicos da condensação (T-17.20). Nível 0 = nada de dentro do grafo é dependência (base);
// nível(c) = 1 + máx. nível das dependências de c. Nós em ciclo compartilham o nível do SCC.

export interface Niveis {
  /** Nível de cada nó. */
  nivel: Int32Array;
  maximo: number;
}

export function niveisTopologicos(g: GrafoMemoria, scc: ComponentesFortes = componentesFortes(g)): Niveis {
  const k = scc.total;
  // Tarjan numera os SCCs em ordem topológica reversa: dependências (saída) têm id MENOR ou igual. Basta uma passada.
  const nivelComp = new Int32Array(k);
  const porComp: number[][] = Array.from({ length: k }, () => []);
  for (let v = 0; v < g.n; v++) porComp[scc.componente[v]!]!.push(v);
  let maximo = 0;
  for (let c = 0; c < k; c++) {
    let nv = 0;
    for (const v of porComp[c]!) {
      for (let e = g.saidaOff[v]!; e < g.saidaOff[v + 1]!; e++) {
        const w = scc.componente[g.saidaDst[e]!]!;
        if (w !== c && nivelComp[w]! + 1 > nv) nv = nivelComp[w]! + 1;
      }
    }
    nivelComp[c] = nv;
    if (nv > maximo) maximo = nv;
  }
  const nivel = new Int32Array(g.n);
  for (let v = 0; v < g.n; v++) nivel[v] = nivelComp[scc.componente[v]!]!;
  return { nivel, maximo };
}
