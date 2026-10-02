// Gerencia os índices em RAM por (coleção, modelo): construção em fatias a partir de `rag_vetor` (warm-up em segundo plano).
// Consulta com índice incompleto usa o que já carregou e o Buscador marca `degradado`.
import type { Repos } from "../repos";
import { criarIndice, escolherEstrategia, type Estrategia } from "./seletor";
import type { IndiceVetorial } from "./indice";

interface Entrada {
  indice: IndiceVetorial;
  estrategia: Estrategia;
  fonte: Generator<{ id: string; vetor: Float32Array }> | null;
}

export class GerenciadorIndices {
  private readonly mapa = new Map<string, Entrada>();
  constructor(private readonly repos: Repos, private readonly opcoes: { sqlite_vec_ok?: boolean; memoria_max_bytes?: number } = {}) {}
  private chave = (c: string, m: string): string => `${c}\n${m}`;

  private entrada(colecao_id: string, modelo: string, dim: number): Entrada {
    const k = this.chave(colecao_id, modelo);
    let e = this.mapa.get(k);
    if (!e) {
      const { com } = this.repos.vetor.cobertura(colecao_id, modelo);
      const sel = { n: Math.max(com, 1), dim, ...this.opcoes };
      const estrategia = escolherEstrategia(sel);
      e = { indice: criarIndice(estrategia, dim, (ids) => this.repos.vetor.porIds(modelo, ids)), estrategia, fonte: this.repos.vetor.iterar(colecao_id, modelo) };
      this.mapa.set(k, e);
    }
    return e;
  }

  /** Carrega vetores até `orcamentoMs`; devolve se o índice está completo. */
  aquecer(colecao_id: string, modelo: string, dim: number, orcamentoMs = Infinity, agora: () => number = () => performance.now()): boolean {
    const e = this.entrada(colecao_id, modelo, dim);
    if (e.fonte === null) return true;
    const inicio = agora();
    let n = 0;
    for (;;) {
      const r = e.fonte.next();
      if (r.done) {
        e.fonte = null;
        return true;
      }
      e.indice.upsert(r.value.id, r.value.vetor);
      if (++n % 256 === 0 && agora() - inicio >= orcamentoMs) return false;
    }
  }

  indice(colecao_id: string, modelo: string, dim: number): { indice: IndiceVetorial; completo: boolean; estrategia: Estrategia } {
    const e = this.entrada(colecao_id, modelo, dim);
    return { indice: e.indice, completo: e.fonte === null, estrategia: e.estrategia };
  }

  /** Indexação incremental: só atualiza índices já abertos (os demais constroem a partir do banco). */
  upsert(colecao_id: string, modelo: string, id: string, vetor: Float32Array): void {
    this.mapa.get(this.chave(colecao_id, modelo))?.indice.upsert(id, vetor);
  }
  remover(colecao_id: string, ids: readonly string[]): void {
    for (const [k, e] of this.mapa) if (k.startsWith(`${colecao_id}\n`)) e.indice.remover(ids);
  }
  descartar(colecao_id: string, modelo?: string): void {
    for (const [k, e] of this.mapa) {
      if (!k.startsWith(`${colecao_id}\n`) || (modelo !== undefined && k !== this.chave(colecao_id, modelo))) continue;
      e.indice.liberar();
      this.mapa.delete(k);
    }
  }
  bytes(): number {
    let n = 0;
    for (const e of this.mapa.values()) n += e.indice.bytes();
    return n;
  }
  liberar(): void {
    for (const e of this.mapa.values()) e.indice.liberar();
    this.mapa.clear();
  }
}
