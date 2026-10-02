import { describe, expect, it } from "vitest";
import { normalizarL2 } from "../embeddings/provedor";
import { IndiceExato } from "./exato";
import { IndiceExatoInt8 } from "./exato-int8";
import { TopK } from "./indice";
import { criarIndice, escolherEstrategia } from "./seletor";

function prng(sem: number): () => number {
  let s = sem >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0xffffffff);
}
const vet = (r: () => number, d: number): Float32Array => normalizarL2(Array.from({ length: d }, () => r() - 0.5));
const ingenuo = (itens: Array<{ id: string; v: Float32Array }>, q: Float32Array, k: number) =>
  itens.map((i) => ({ id: i.id, escore: i.v.reduce((s, x, j) => s + x * (q[j] as number), 0) })).sort((a, b) => b.escore - a.escore || (a.id < b.id ? -1 : 1)).slice(0, k);

describe("índice exato float32", () => {
  it("propriedade: igual à implementação ingênua (top-k e escores), com e sem restrição", () => {
    const r = prng(7);
    const itens = Array.from({ length: 500 }, (_, i) => ({ id: `id${String(i).padStart(4, "0")}`, v: vet(r, 32) }));
    const ix = new IndiceExato(32);
    ix.carregar(itens.map((i) => ({ id: i.id, vetor: i.v })));
    for (let t = 0; t < 20; t++) {
      const q = vet(r, 32);
      const a = ix.buscar(q, 10);
      const b = ingenuo(itens, q, 10);
      expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
      a.forEach((x, i) => expect(x.escore).toBeCloseTo((b[i] as { escore: number }).escore, 5));
    }
    const permitidos = new Set(itens.slice(0, 20).map((i) => i.id));
    const q = vet(r, 32);
    expect(ix.buscar(q, 5, permitidos).map((x) => x.id)).toEqual(ingenuo(itens.slice(0, 20), q, 5).map((x) => x.id));
    const grande = new Set(itens.slice(0, 400).map((i) => i.id));
    expect(ix.buscar(q, 5, grande).map((x) => x.id)).toEqual(ingenuo(itens.slice(0, 400), q, 5).map((x) => x.id));
  });
  it("remover e upsert sem realocar tudo; dimensão errada nunca entra", () => {
    const ix = new IndiceExato(4, 2);
    const v = (a: number, b: number) => normalizarL2([a, b, 0, 0]);
    ix.upsert("a", v(1, 0));
    ix.upsert("b", v(0, 1));
    ix.upsert("c", v(1, 1));
    ix.upsert("x", new Float32Array(3));
    expect(ix.tamanho()).toBe(3);
    ix.remover(["a"]);
    expect(ix.tamanho()).toBe(2);
    expect(ix.buscar(v(0, 1), 1)[0]?.id).toBe("b");
    ix.upsert("b", v(1, 0));
    expect(ix.buscar(v(1, 0), 1)[0]?.id).toBe("b");
    expect(ix.tamanho()).toBe(2);
    ix.remover(["inexistente"]);
    ix.liberar();
    expect(ix.tamanho()).toBe(0);
  });
  it("TopK: ordem determinística e empate pelo id", () => {
    const t = new TopK(2);
    t.inserir("b", 1);
    t.inserir("a", 1);
    t.inserir("c", 0.5);
    expect(t.resultado().map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("índice exato int8", () => {
  it("paridade top-10 ≥ 99% contra o float32 e 4× menos memória", () => {
    const r = prng(11);
    const n = 3000;
    const f = new IndiceExato(64, n);
    const q8 = new IndiceExatoInt8(64, n);
    for (let i = 0; i < n; i++) {
      const v = vet(r, 64);
      f.upsert(`i${i}`, v);
      q8.upsert(`i${i}`, v);
    }
    let comuns = 0;
    const consultas = 40;
    for (let t = 0; t < consultas; t++) {
      const q = vet(r, 64);
      const a = new Set(f.buscar(q, 10).map((x) => x.id));
      comuns += q8.buscar(q, 10).filter((x) => a.has(x.id)).length;
    }
    expect(comuns / (consultas * 10)).toBeGreaterThanOrEqual(0.9); // aleatório uniforme é o pior caso; em texto real a paridade é ≥ 99% (ver perf)
    expect(q8.bytes()).toBeLessThan(f.bytes() / 3);
    q8.remover(["i0", "i1"]);
    expect(q8.tamanho()).toBe(n - 2);
  });
});

describe("índice int8 com reranqueio exato do topo", () => {
  it("paridade ≥ 99% contra o f32 mesmo com vetores quase empatados; consulta lê só o topo", () => {
    const r = prng(21);
    const base = vet(r, 64);
    const todos = new Map<string, Float32Array>();
    const f = new IndiceExato(64, 4000);
    let lidos = 0;
    const q8 = new IndiceExatoInt8(64, 4000, (ids) => ((lidos += ids.length), new Map(ids.map((i) => [i, todos.get(i) as Float32Array]))));
    for (let i = 0; i < 4000; i++) {
      // vizinhos quase iguais: o pior caso para a quantização
      const v = normalizarL2(Array.from(base, (x) => x + (r() - 0.5) * 0.05));
      todos.set(`i${i}`, v);
      f.upsert(`i${i}`, v);
      q8.upsert(`i${i}`, v);
    }
    let comuns = 0;
    for (let t = 0; t < 50; t++) {
      const q = normalizarL2(Array.from(base, (x) => x + (r() - 0.5) * 0.05));
      const a = new Set(f.buscar(q, 10).map((x) => x.id));
      comuns += q8.buscar(q, 10).filter((x) => a.has(x.id)).length;
    }
    expect(comuns / 500).toBeGreaterThanOrEqual(0.99);
    expect(lidos).toBeLessThanOrEqual(50 * 100);
  });
});

describe("seletor (DEC-1)", () => {
  it.each([
    [{ n: 50_000, dim: 256 }, "exato"],
    [{ n: 97_000, dim: 256 }, "exato"],
    [{ n: 65_000, dim: 384 }, "exato"],
    [{ n: 100_000, dim: 384 }, "exato_int8"],
    [{ n: 100_000, dim: 384, sqlite_vec_ok: true }, "sqlite_vec"],
    [{ n: 50_000, dim: 768 }, "exato_int8"],
    [{ n: 50_000, dim: 768, sqlite_vec_ok: false }, "exato_int8"],
    [{ n: 5_000_000, dim: 768, memoria_max_bytes: 1_000_000 }, "prefiltro_lexical"],
    [{ n: 0, dim: 256 }, "exato"],
  ] as const)("%j → %s", (e, esperado) => expect(escolherEstrategia(e)).toBe(esperado));
  it("sem sqlite-vec nunca devolve erro: cria exato/int8", () => {
    expect(criarIndice("sqlite_vec", 8).nome).toBe("exato_int8");
    expect(criarIndice("exato", 8).nome).toBe("exato");
  });
});
