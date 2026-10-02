// Armazenamento/índice vetorial da memória: BLOB Float32 em `memoria_vetor` + varredura exata SOBRE O RECORTE ESCOPADO (≤ milhares
// de linhas: linhagem, Missão ou anel 2), então não há índice global em RAM (P-41) nem dependência nativa. A Fase 15 tem o seu
// próprio índice (`conhecimento.db`, worker); isto aqui serve só à busca semântica da memória e é reutilizável.
export function paraBytes(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

export function deBytes(b: Uint8Array): Float32Array {
  const copia = new Uint8Array(b.byteLength);
  copia.set(b);
  return new Float32Array(copia.buffer, 0, Math.floor(copia.byteLength / 4));
}

/** Produto interno (= cosseno para vetores L2-normalizados). Dimensões diferentes → 0. */
export function cosseno(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
}

export interface Candidato {
  id: string;
  vetor: Float32Array;
}

/** Top-K por cosseno (empate pelo id, para saída determinística). */
export function topK(consulta: Float32Array, candidatos: Iterable<Candidato>, k: number, minimo = 0.05): Array<{ id: string; escore: number }> {
  const todos: Array<{ id: string; escore: number }> = [];
  for (const c of candidatos) {
    const e = cosseno(consulta, c.vetor);
    if (e >= minimo) todos.push({ id: c.id, escore: e });
  }
  todos.sort((x, y) => y.escore - x.escore || (x.id < y.id ? -1 : 1));
  return todos.slice(0, k);
}

/** Fusão por RRF (k = 60) de listas ordenadas de ids, com peso por lista. */
export function fundirRRF(listas: Array<{ ids: string[]; peso: number }>, k = 60): string[] {
  const escore = new Map<string, number>();
  for (const l of listas) l.ids.forEach((id, i) => escore.set(id, (escore.get(id) ?? 0) + l.peso / (k + i + 1)));
  return [...escore.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
}
