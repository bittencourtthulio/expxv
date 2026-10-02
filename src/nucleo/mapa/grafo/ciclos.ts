import type { GrafoMemoria } from "./memoria";

// Tarjan ITERATIVO (sem recursão): componentes fortemente conexos e ciclos (T-17.20).

export interface ComponentesFortes {
  /** `componente[i]` = id do SCC do nó i (ordem topológica reversa de Tarjan: 0 = sumidouro). */
  componente: Int32Array;
  total: number;
}

export function componentesFortes(g: GrafoMemoria): ComponentesFortes {
  const n = g.n;
  const indice = new Int32Array(n).fill(-1);
  const baixo = new Int32Array(n);
  const naPilha = new Uint8Array(n);
  const comp = new Int32Array(n).fill(-1);
  const pilha = new Int32Array(n);
  let topo = 0;
  const chamada = new Int32Array(n);
  const prox = new Int32Array(n); // próxima aresta de cada nó em visita
  let contador = 0;
  let total = 0;
  for (let raiz = 0; raiz < n; raiz++) {
    if (indice[raiz] !== -1) continue;
    let cp = 0;
    chamada[cp++] = raiz;
    indice[raiz] = baixo[raiz] = contador++;
    pilha[topo++] = raiz;
    naPilha[raiz] = 1;
    prox[raiz] = g.saidaOff[raiz]!;
    while (cp > 0) {
      const v = chamada[cp - 1]!;
      if (prox[v]! < g.saidaOff[v + 1]!) {
        const w = g.saidaDst[prox[v]!++]!;
        if (indice[w] === -1) {
          indice[w] = baixo[w] = contador++;
          pilha[topo++] = w;
          naPilha[w] = 1;
          prox[w] = g.saidaOff[w]!;
          chamada[cp++] = w;
        } else if (naPilha[w] === 1) {
          if (indice[w]! < baixo[v]!) baixo[v] = indice[w]!;
        }
      } else {
        if (baixo[v] === indice[v]) {
          for (;;) {
            const w = pilha[--topo]!;
            naPilha[w] = 0;
            comp[w] = total;
            if (w === v) break;
          }
          total++;
        }
        cp--;
        if (cp > 0) {
          const pai = chamada[cp - 1]!;
          if (baixo[v]! < baixo[pai]!) baixo[pai] = baixo[v]!;
        }
      }
    }
  }
  return { componente: comp, total };
}

export interface Ciclo {
  /** Índices dos nós do ciclo (SCC com 2+ nós), em ordem crescente. */
  nos: number[];
  tamanho: number;
  /** Arestas internas de menor peso (candidatas a quebrar o ciclo), até 3. */
  quebrar: Array<{ de: number; para: number; peso: number }>;
}

/** SCCs com 2 ou mais nós, do maior para o menor (desempate pelo menor índice). */
export function ciclos(g: GrafoMemoria, scc: ComponentesFortes = componentesFortes(g)): Ciclo[] {
  const grupos = new Map<number, number[]>();
  for (let i = 0; i < g.n; i++) {
    const c = scc.componente[i]!;
    let l = grupos.get(c);
    if (l === undefined) grupos.set(c, (l = []));
    l.push(i);
  }
  const saida: Ciclo[] = [];
  for (const nos of grupos.values()) {
    if (nos.length < 2) continue;
    const c = scc.componente[nos[0]!]!;
    const internas: Array<{ de: number; para: number; peso: number }> = [];
    for (const v of nos) {
      for (let k = g.saidaOff[v]!; k < g.saidaOff[v + 1]!; k++) {
        const w = g.saidaDst[k]!;
        if (scc.componente[w] === c) internas.push({ de: v, para: w, peso: g.saidaPeso[k]! });
      }
    }
    internas.sort((a, b) => a.peso - b.peso || a.de - b.de || a.para - b.para);
    saida.push({ nos, tamanho: nos.length, quebrar: internas.slice(0, 3) });
  }
  saida.sort((a, b) => b.tamanho - a.tamanho || a.nos[0]! - b.nos[0]!);
  return saida;
}
