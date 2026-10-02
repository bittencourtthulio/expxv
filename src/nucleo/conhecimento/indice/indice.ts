// Interface do índice vetorial (T-15.08). O índice EXATO em RAM é o caminho padrão e o fallback obrigatório (D-80/D-81);
// `rag_vetor` é a fonte e qualquer índice é derivável (warm-up em segundo plano).
export interface ResultadoVetorial {
  id: string;
  escore: number;
}

export interface IndiceVetorial {
  readonly nome: "exato" | "exato_int8" | "sqlite_vec";
  carregar(itens: Iterable<{ id: string; vetor: Float32Array }>): void;
  upsert(id: string, vetor: Float32Array): void;
  remover(ids: Iterable<string>): void;
  /** Produto interno (= cosseno para vetores L2-normalizados). `permitidos` restringe o conjunto varrido. */
  buscar(vetor: Float32Array, k: number, permitidos?: ReadonlySet<string> | null): ResultadoVetorial[];
  tamanho(): number;
  bytes(): number;
  liberar(): void;
}

/** Mantém os `k` melhores (maior escore; empate pelo id, saída determinística) sem ordenar tudo. */
export class TopK {
  private readonly ids: string[] = [];
  private readonly escores: number[] = [];
  private minimo = -Infinity;
  constructor(private readonly k: number) {}
  aceita(escore: number): boolean {
    return this.ids.length < this.k || escore > this.minimo;
  }
  inserir(id: string, escore: number): void {
    if (!this.aceita(escore)) return;
    let i = this.ids.length;
    while (i > 0 && (this.escores[i - 1] as number) < escore) i--;
    this.ids.splice(i, 0, id);
    this.escores.splice(i, 0, escore);
    if (this.ids.length > this.k) {
      this.ids.pop();
      this.escores.pop();
    }
    this.minimo = this.ids.length >= this.k ? (this.escores[this.escores.length - 1] as number) : -Infinity;
  }
  resultado(): ResultadoVetorial[] {
    const r = this.ids.map((id, i) => ({ id, escore: this.escores[i] as number }));
    return r.sort((a, b) => b.escore - a.escore || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}
