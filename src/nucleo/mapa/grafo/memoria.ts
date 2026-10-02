import type { Armazem } from "../armazem";
import type { Confianca } from "../tipos";

// Grafo em memória (T-17.20): formato CSR com `Int32Array` (saída e entrada), sem objetos por aresta.
// Puro: nenhuma recursão; construído a partir de listas ou do armazém (somente leitura).

export interface ArestaGrafo {
  de: string;
  para: string;
  tipo?: string;
  confianca?: Confianca;
  peso?: number;
}

export interface OpcoesConstrucao {
  /** Só arestas destes tipos (ex.: `["importa", "reexporta"]`). Ausente = todos. */
  tipos?: readonly string[];
  /** `exata` descarta as heurísticas. */
  minConfianca?: Confianca;
}

export class GrafoMemoria {
  /** Número de nós. */
  readonly n: number;
  /** Arestas distintas (depois de fundir paralelas e descartar laços). */
  readonly m: number;
  /** Laços (`a → a`) descartados na construção. */
  readonly lacos: number;
  readonly saidaOff: Int32Array;
  readonly saidaDst: Int32Array;
  readonly saidaPeso: Int32Array;
  /** 1 = exata, 0 = heurística. */
  readonly saidaExata: Uint8Array;
  readonly entradaOff: Int32Array;
  readonly entradaSrc: Int32Array;
  readonly entradaPeso: Int32Array;
  readonly entradaExata: Uint8Array;
  private readonly mapa: Map<string, number>;

  constructor(
    readonly ids: readonly string[],
    arestas: ReadonlyArray<{ de: number; para: number; peso: number; exata: boolean }>,
    lacos = 0,
  ) {
    this.n = ids.length;
    this.lacos = lacos;
    this.mapa = new Map(ids.map((id, i) => [id, i]));
    const n = this.n;
    // Funde arestas paralelas (soma pesos; exata se alguma é exata).
    const fundidas = new Map<number, { de: number; para: number; peso: number; exata: boolean }>();
    for (const a of arestas) {
      const k = a.de * n + a.para;
      const e = fundidas.get(k);
      if (e === undefined) fundidas.set(k, { ...a });
      else {
        e.peso += a.peso;
        e.exata = e.exata || a.exata;
      }
    }
    const lista = [...fundidas.values()];
    this.m = lista.length;
    this.saidaOff = new Int32Array(n + 1);
    this.entradaOff = new Int32Array(n + 1);
    for (const a of lista) {
      this.saidaOff[a.de + 1]! += 1;
      this.entradaOff[a.para + 1]! += 1;
    }
    for (let i = 0; i < n; i++) {
      this.saidaOff[i + 1]! += this.saidaOff[i]!;
      this.entradaOff[i + 1]! += this.entradaOff[i]!;
    }
    this.saidaDst = new Int32Array(lista.length);
    this.saidaPeso = new Int32Array(lista.length);
    this.saidaExata = new Uint8Array(lista.length);
    this.entradaSrc = new Int32Array(lista.length);
    this.entradaPeso = new Int32Array(lista.length);
    this.entradaExata = new Uint8Array(lista.length);
    const ps = this.saidaOff.slice(0, n);
    const pe = this.entradaOff.slice(0, n);
    // Ordem determinística: por (de, para).
    lista.sort((x, y) => x.de - y.de || x.para - y.para);
    for (const a of lista) {
      const i = ps[a.de]!++;
      this.saidaDst[i] = a.para;
      this.saidaPeso[i] = a.peso;
      this.saidaExata[i] = a.exata ? 1 : 0;
      const j = pe[a.para]!++;
      this.entradaSrc[j] = a.de;
      this.entradaPeso[j] = a.peso;
      this.entradaExata[j] = a.exata ? 1 : 0;
    }
  }

  /** Índice do nó, ou -1. */
  indice(id: string): number {
    return this.mapa.get(id) ?? -1;
  }

  grauSaida(i: number): number {
    return this.saidaOff[i + 1]! - this.saidaOff[i]!;
  }

  grauEntrada(i: number): number {
    return this.entradaOff[i + 1]! - this.entradaOff[i]!;
  }
}

/** Constrói o grafo a partir de listas em memória. Nós ausentes da lista, mas citados por arestas, são criados. */
export function construirGrafo(nos: Iterable<string>, arestas: Iterable<ArestaGrafo>, opcoes: OpcoesConstrucao = {}): GrafoMemoria {
  const ids: string[] = [];
  const idx = new Map<string, number>();
  const garantir = (id: string): number => {
    let i = idx.get(id);
    if (i === undefined) {
      i = ids.length;
      ids.push(id);
      idx.set(id, i);
    }
    return i;
  };
  for (const id of nos) garantir(id);
  const tipos = opcoes.tipos === undefined ? null : new Set(opcoes.tipos);
  const brutas: Array<{ de: number; para: number; peso: number; exata: boolean }> = [];
  let lacos = 0;
  for (const a of arestas) {
    if (tipos !== null && (a.tipo === undefined || !tipos.has(a.tipo))) continue;
    const exata = (a.confianca ?? "exata") === "exata";
    if (opcoes.minConfianca === "exata" && !exata) continue;
    const de = garantir(a.de);
    const para = garantir(a.para);
    if (de === para) {
      lacos++;
      continue;
    }
    brutas.push({ de, para, peso: a.peso ?? 1, exata });
  }
  return new GrafoMemoria(ids, brutas, lacos);
}

/** Constrói a partir do armazém (somente leitura): todos os nós e as arestas dos tipos pedidos. */
export function grafoDoArmazem(armazem: Pick<Armazem, "banco">, opcoes: OpcoesConstrucao = {}): GrafoMemoria {
  const nos = armazem.banco.consultar<{ id: string }>("SELECT id FROM no").map((l) => l.id);
  const arestas = armazem.banco
    .consultar<{ de: string; para: string; tipo: string; confianca: string; peso: number }>("SELECT de, para, tipo, confianca, peso FROM aresta")
    .map((l) => ({ de: l.de, para: l.para, tipo: l.tipo, confianca: l.confianca as Confianca, peso: l.peso }));
  return construirGrafo(nos, arestas, opcoes);
}
