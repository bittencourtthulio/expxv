// Agrupamento colapsável do grafo (puro): módulo/pasta/arquivo -> clusters. Acima de 5 000 nós o agrupamento é obrigatório.
import type { ArestaGrafoMapa, GrafoMapaIpc, NoGrafoMapa, TipoArestaIpc } from "../../../compartilhado/mapa";

export type ModoAgrupar = "modulo" | "pasta" | "arquivo";
export const LIMIAR_AGRUPAR = 5000;

export interface NoAgrupado {
  id: string;
  rotulo: string;
  /** Cluster colapsado (id `cl:<grupo>`) ou nó original. */
  cluster: boolean;
  membros: number;
  w: number;
  grupo: string;
  original: NoGrafoMapa | null;
  ciclo: boolean;
}

export interface GrafoAgrupado {
  nos: NoAgrupado[];
  /** `[de, para, tipo, exata, peso]` com índices em `nos`. */
  arestas: ArestaGrafoMapa[];
  agrupado: boolean;
}

export function chaveGrupo(no: NoGrafoMapa, modo: ModoAgrupar): string {
  if (modo === "arquivo") return no.id;
  if (modo === "pasta") return no.g.split("/")[0] || ".";
  return no.g;
}

/** Decide o modo efetivo: acima do limiar "arquivo" vira "modulo". */
export function modoEfetivo(modo: ModoAgrupar, nNos: number): ModoAgrupar {
  return modo === "arquivo" && nNos > LIMIAR_AGRUPAR ? "modulo" : modo;
}

export function agrupar(grafo: Pick<GrafoMapaIpc, "nos" | "arestas">, modo: ModoAgrupar, expandidos: ReadonlySet<string>): GrafoAgrupado {
  const efetivo = modoEfetivo(modo, grafo.nos.length);
  if (efetivo === "arquivo") {
    return { agrupado: false, nos: grafo.nos.map((n) => ({ id: n.id, rotulo: n.r, cluster: false, membros: 1, w: n.w, grupo: n.g, original: n, ciclo: n.c !== undefined })), arestas: grafo.arestas.map((a) => [...a] as ArestaGrafoMapa) };
  }
  const nos: NoAgrupado[] = [];
  const indiceNo = new Map<string, number>();
  const destino: number[] = new Array<number>(grafo.nos.length);
  const clusters = new Map<string, number>();
  grafo.nos.forEach((n, i) => {
    const g = chaveGrupo(n, efetivo);
    if (expandidos.has(g)) {
      const k = nos.length;
      nos.push({ id: n.id, rotulo: n.r, cluster: false, membros: 1, w: n.w, grupo: g, original: n, ciclo: n.c !== undefined });
      indiceNo.set(n.id, k);
      destino[i] = k;
      return;
    }
    let k = clusters.get(g);
    if (k === undefined) {
      k = nos.length;
      nos.push({ id: `cl:${g}`, rotulo: g, cluster: true, membros: 0, w: 0, grupo: g, original: null, ciclo: false });
      clusters.set(g, k);
    }
    const c = nos[k] as NoAgrupado;
    c.membros++;
    c.w += n.w;
    if (n.c !== undefined) c.ciclo = true;
    destino[i] = k;
  });
  const fundidas = new Map<string, { de: number; para: number; tipo: TipoArestaIpc; exata: 0 | 1; peso: number }>();
  for (const [d, p, tipo, exata, peso] of grafo.arestas) {
    const a = destino[d] as number;
    const b = destino[p] as number;
    if (a === b) continue;
    const k = `${a}>${b}`;
    const e = fundidas.get(k);
    if (e === undefined) fundidas.set(k, { de: a, para: b, tipo, exata, peso });
    else { e.peso += peso; if (exata === 1) e.exata = 1; }
  }
  return { agrupado: true, nos, arestas: [...fundidas.values()].map((e) => [e.de, e.para, e.tipo, e.exata, e.peso] as ArestaGrafoMapa) };
}

/** Alterna a expansão de um cluster (`cl:<grupo>`) ou recolhe o grupo de um nó expandido. */
export function alternarExpansao(expandidos: ReadonlySet<string>, grupo: string): Set<string> {
  const novo = new Set(expandidos);
  if (novo.has(grupo)) novo.delete(grupo);
  else novo.add(grupo);
  return novo;
}
