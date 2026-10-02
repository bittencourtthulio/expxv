// Índice exato float32: vetores contíguos num único Float32Array (mapa id↔slot), varredura com produto interno.
// `remover` troca com o último slot (sem realocar tudo); crescimento por dobra.
import { TopK, type IndiceVetorial, type ResultadoVetorial } from "./indice";

export class IndiceExato implements IndiceVetorial {
  readonly nome = "exato" as const;
  private dados: Float32Array;
  private ids: string[] = [];
  private slots = new Map<string, number>();
  constructor(readonly dimensao: number, capacidade = 1024) {
    this.dados = new Float32Array(Math.max(16, capacidade) * dimensao);
  }
  private garantir(n: number): void {
    const precisa = n * this.dimensao;
    if (precisa <= this.dados.length) return;
    let cap = this.dados.length;
    while (cap < precisa) cap *= 2;
    const novo = new Float32Array(cap);
    novo.set(this.dados.subarray(0, this.ids.length * this.dimensao));
    this.dados = novo;
  }
  carregar(itens: Iterable<{ id: string; vetor: Float32Array }>): void {
    for (const it of itens) this.upsert(it.id, it.vetor);
  }
  upsert(id: string, vetor: Float32Array): void {
    if (vetor.length !== this.dimensao) return; // dimensão errada nunca entra
    let slot = this.slots.get(id);
    if (slot === undefined) {
      slot = this.ids.length;
      this.garantir(slot + 1);
      this.ids.push(id);
      this.slots.set(id, slot);
    }
    this.dados.set(vetor, slot * this.dimensao);
  }
  remover(ids: Iterable<string>): void {
    const d = this.dimensao;
    for (const id of ids) {
      const slot = this.slots.get(id);
      if (slot === undefined) continue;
      const ultimo = this.ids.length - 1;
      if (slot !== ultimo) {
        this.dados.copyWithin(slot * d, ultimo * d, (ultimo + 1) * d);
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
    const top = new TopK(k);
    const dados = this.dados;
    const pontuar = (slot: number): number => {
      let s = 0;
      const base = slot * d;
      for (let i = 0; i < d; i++) s += (dados[base + i] as number) * (q[i] as number);
      return s;
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
        const e = pontuar(slot);
        if (top.aceita(e)) top.inserir(id, e);
      }
    }
    return top.resultado();
  }
  tamanho(): number {
    return this.ids.length;
  }
  bytes(): number {
    return this.dados.byteLength;
  }
  liberar(): void {
    this.dados = new Float32Array(0);
    this.ids = [];
    this.slots.clear();
  }
}
