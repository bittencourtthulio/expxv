// Índice exato int8: quantização escalar por vetor (escala = max|v|/127). 4× menos memória e banda; a consulta fica em float32.
import { TopK, type IndiceVetorial, type ResultadoVetorial } from "./indice";

/** Resolve os vetores float32 de ids (ex.: do `rag_vetor`) para reordenar o topo do int8. */
export type ResolverFloat = (ids: string[]) => Map<string, Float32Array>;

/** Candidatos extras do int8 antes do reranqueio exato (k × este fator = 100 leituras de vetor por consulta no máximo para k=10). */
const SOBRA_RERANK = 10;

export class IndiceExatoInt8 implements IndiceVetorial {
  readonly nome = "exato_int8" as const;
  private dados: Int8Array;
  private escalas: Float32Array;
  private ids: string[] = [];
  private slots = new Map<string, number>();
  constructor(readonly dimensao: number, capacidade = 1024, private readonly resolverFloat: ResolverFloat | null = null) {
    this.dados = new Int8Array(Math.max(16, capacidade) * dimensao);
    this.escalas = new Float32Array(Math.max(16, capacidade));
  }
  private garantir(n: number): void {
    if (n * this.dimensao <= this.dados.length) return;
    let cap = this.escalas.length;
    while (cap < n) cap *= 2;
    const d = new Int8Array(cap * this.dimensao);
    d.set(this.dados.subarray(0, this.ids.length * this.dimensao));
    const e = new Float32Array(cap);
    e.set(this.escalas.subarray(0, this.ids.length));
    this.dados = d;
    this.escalas = e;
  }
  carregar(itens: Iterable<{ id: string; vetor: Float32Array }>): void {
    for (const it of itens) this.upsert(it.id, it.vetor);
  }
  upsert(id: string, vetor: Float32Array): void {
    if (vetor.length !== this.dimensao) return;
    let slot = this.slots.get(id);
    if (slot === undefined) {
      slot = this.ids.length;
      this.garantir(slot + 1);
      this.ids.push(id);
      this.slots.set(id, slot);
    }
    let max = 0;
    for (let i = 0; i < vetor.length; i++) max = Math.max(max, Math.abs(vetor[i] as number));
    const escala = max === 0 ? 1 : max / 127;
    this.escalas[slot] = escala;
    const base = slot * this.dimensao;
    for (let i = 0; i < vetor.length; i++) this.dados[base + i] = Math.round((vetor[i] as number) / escala);
  }
  remover(ids: Iterable<string>): void {
    const d = this.dimensao;
    for (const id of ids) {
      const slot = this.slots.get(id);
      if (slot === undefined) continue;
      const ultimo = this.ids.length - 1;
      if (slot !== ultimo) {
        this.dados.copyWithin(slot * d, ultimo * d, (ultimo + 1) * d);
        this.escalas[slot] = this.escalas[ultimo] as number;
        const idUltimo = this.ids[ultimo] as string;
        this.ids[slot] = idUltimo;
        this.slots.set(idUltimo, slot);
      }
      this.ids.pop();
      this.slots.delete(id);
    }
  }
  buscar(q: Float32Array, k: number, permitidos?: ReadonlySet<string> | null): ResultadoVetorial[] {
    const d = this.dimensao;
    if (q.length !== d || k <= 0) return [];
    const rerank = this.resolverFloat !== null;
    const top = new TopK(rerank ? Math.max(k, k * SOBRA_RERANK) : k);
    const dados = this.dados;
    const pontuar = (slot: number): number => {
      let s = 0;
      const base = slot * d;
      for (let i = 0; i < d; i++) s += (dados[base + i] as number) * (q[i] as number);
      return s * (this.escalas[slot] as number);
    };
    const finalizar = (): ResultadoVetorial[] => {
      const cand = top.resultado();
      if (!this.resolverFloat) return cand.slice(0, k);
      // reranqueio EXATO só do topo (poucas leituras de vetor): paridade ≥ 99 % com o f32 e RAM 4× menor
      const vs = this.resolverFloat(cand.map((c) => c.id));
      return cand
        .map((c) => {
          const v = vs.get(c.id);
          if (!v || v.length !== d) return c;
          let e = 0;
          for (let i = 0; i < d; i++) e += (v[i] as number) * (q[i] as number);
          return { id: c.id, escore: e };
        })
        .sort((a, b) => b.escore - a.escore || (a.id < b.id ? -1 : 1))
        .slice(0, k);
    };
    if (permitidos && permitidos.size < this.ids.length / 2) {
      for (const id of permitidos) {
        const slot = this.slots.get(id);
        if (slot !== undefined) top.inserir(id, pontuar(slot));
      }
    } else {
      const n = this.ids.length;
      for (let slot = 0; slot < n; slot++) {
        const id = this.ids[slot] as string;
        if (permitidos && !permitidos.has(id)) continue;
        top.inserir(id, pontuar(slot));
      }
    }
    return finalizar();
  }
  tamanho(): number {
    return this.ids.length;
  }
  bytes(): number {
    return this.dados.byteLength + this.escalas.byteLength;
  }
  liberar(): void {
    this.dados = new Int8Array(0);
    this.escalas = new Float32Array(0);
    this.ids = [];
    this.slots.clear();
  }
}
