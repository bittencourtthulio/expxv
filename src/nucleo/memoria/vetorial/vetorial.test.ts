import { afterEach, describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import type { Banco } from "../../banco";
import { novoBancoMemoria, semearMissao, semearPane, semearWorkspace } from "../../../../tests/fixtures/memoria/banco";
import { resolverContextoDoPane } from "../contexto";
import { criarEscritor } from "../escrita";
import { buscarHibrida, indexarVetores, pendentesDeVetor } from "./busca";
import { criarProvedorHash, embutirHash, exigirConsentimento, MODELO_HASH, type ProvedorEmbedding } from "./embedding";
import { cosseno, deBytes, fundirRRF, paraBytes, topK } from "./indice";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

describe("embedding hash-256-v1", () => {
  it("determinístico bit a bit, L2-normalizado, dimensão 256; texto vazio = vetor nulo", () => {
    const a = embutirHash("Autenticação com token JWT e refresh");
    const b = embutirHash("Autenticação com token JWT e refresh");
    expect(Buffer.from(a.buffer)).toEqual(Buffer.from(b.buffer));
    expect(a).toHaveLength(256);
    expect(Math.abs(cosseno(a, a) - 1)).toBeLessThan(1e-5);
    expect(embutirHash("   ").every((x) => x === 0)).toBe(true);
  });
  it("textos parecidos ficam mais perto que textos distintos (acentos e caixa não importam)", () => {
    const q = embutirHash("autenticacao jwt token");
    expect(cosseno(q, embutirHash("Usamos autenticação por token JWT com refresh"))).toBeGreaterThan(cosseno(q, embutirHash("A fila de emails usa Redis e workers")));
  });
  it("≤ 1 ms por entrada de 1 000 chars (mediana)", () => {
    const t = "Decidimos usar SQLite com FTS5 para a memória local; ver src/nucleo/x.ts. ".repeat(14).slice(0, 1000);
    for (let i = 0; i < 30; i++) embutirHash(t);
    const xs = Array.from({ length: 100 }, () => {
      const t0 = performance.now();
      embutirHash(t);
      return performance.now() - t0;
    }).sort((x, y) => x - y);
    expect(xs[50] ?? 99).toBeLessThan(1);
  });
});

describe("índice e fusão", () => {
  it("serialização ida e volta; topK ordenado e determinístico; fundirRRF combina listas", () => {
    const v = embutirHash("abc def");
    expect(Array.from(deBytes(paraBytes(v)))).toEqual(Array.from(v));
    const q = embutirHash("memória local");
    const r = topK(q, [{ id: "b", vetor: embutirHash("memória local rápida") }, { id: "a", vetor: embutirHash("memória local rápida") }, { id: "c", vetor: embutirHash("zzz yyy xxx") }], 3, 0.01);
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
    expect(fundirRRF([{ ids: ["x", "y", "z"], peso: 1 }, { ids: ["z", "y"], peso: 1 }])).toEqual(["z", "y", "x"]);
  });
});

describe("consentimento de provedor remoto", () => {
  it("provedor não-local só embute com consentimento; local nunca pede", async () => {
    let chamadas = 0;
    const remoto: ProvedorEmbedding = { id: "api:x", dimensao: 8, local: false, embutir: async (t) => (chamadas++, t.map(() => new Float32Array(8))) };
    let ok = false;
    const guardado = exigirConsentimento(remoto, () => ok);
    await expect(guardado.embutir(["x"])).rejects.toThrow(/consentimento/);
    expect(chamadas).toBe(0);
    ok = true;
    await guardado.embutir(["x"]);
    expect(chamadas).toBe(1);
    const local = criarProvedorHash();
    expect(exigirConsentimento(local, () => false)).toBe(local);
  });
});

describe("indexarVetores e buscarHibrida", () => {
  function mundo() {
    const b = novoBancoMemoria();
    abertos.push(b);
    const ws = semearWorkspace(b);
    semearMissao(b, "M1", ws);
    semearPane(b, { id: "A", ws, mission: "M1", papel: "piloto" });
    const e = criarEscritor({ banco: b });
    const ctx = resolverContextoDoPane(b, "A");
    for (const t of ["Autenticação por token JWT com refresh", "Fila de emails com Redis", "Cache de sessão em memória", "Migração do banco para SQLite"]) e.gravar({ ctx, tipo: "fato", conteudo: t, origem: "agente" });
    return { b, ctx };
  }
  it("indexa em lotes, redige antes de embutir (segredo nunca chega ao provedor) e ignora vetor de dimensão errada", async () => {
    const { b } = mundo();
    b.executar("UPDATE memoria_entrada SET conteudo = 'chave sk-abcdefghijklmnopqrstuvwxyz0123456789 aqui' WHERE conteudo LIKE 'Cache%'");
    const recebidos: string[] = [];
    const prov: ProvedorEmbedding = { id: "teste:8", dimensao: 8, local: true, embutir: async (ts) => (recebidos.push(...ts), ts.map((_, i) => (i === 0 ? new Float32Array(3) : new Float32Array(8).fill(0.35)))) };
    expect(pendentesDeVetor(b, "teste:8")).toBe(4);
    const r = await indexarVetores({ banco: b, provedor: prov }, { lote: 10 });
    expect(r.indexadas).toBe(3); // o 1º veio com dimensão errada
    expect(recebidos.join(" ")).not.toContain("sk-abc");
  });
  it("híbrida: acha por semelhança onde o lexical (AND) falha, mantém o escopo e devolve modo 'hibrida'", async () => {
    const { b, ctx } = mundo();
    const prov = criarProvedorHash();
    await indexarVetores({ banco: b, provedor: prov });
    const r = await buscarHibrida({ banco: b, provedor: prov }, { ctx, query: "autenticacao jwt tokens sessao", scope: "pane" });
    expect(r.modo).toBe("hibrida");
    expect(r.degradado).toBe(false);
    expect(r.entries[0]?.content).toContain("JWT");
    expect(r.entries.length).toBeLessThanOrEqual(10);
  });
  it("provedor que falha → degrada para lexical sem lançar; sem query é lexical", async () => {
    const { b, ctx } = mundo();
    const ruim: ProvedorEmbedding = { id: "ruim", dimensao: 8, local: true, embutir: async () => { throw new Error("modelo fora do ar"); } };
    const r = await buscarHibrida({ banco: b, provedor: ruim }, { ctx, query: "redis" });
    expect(r).toMatchObject({ modo: "lexical", degradado: true });
    expect(r.entries.map((e) => e.content)).toEqual(["Fila de emails com Redis"]);
    const sem = await buscarHibrida({ banco: b, provedor: criarProvedorHash() }, { ctx });
    expect(sem).toMatchObject({ modo: "lexical", degradado: false });
    expect(sem.entries).toHaveLength(4);
  });
  it("modelo é isolado: vetores de outro modelo não entram na consulta", async () => {
    const { b, ctx } = mundo();
    await indexarVetores({ banco: b, provedor: criarProvedorHash() });
    const outro: ProvedorEmbedding = { ...criarProvedorHash(), id: "outro:256" };
    const r = await buscarHibrida({ banco: b, provedor: outro }, { ctx, query: "jwt autenticacao" });
    expect(r.modo).toBe("lexical"); // sem vetores desse modelo, só lexical
    expect(MODELO_HASH).toBe("hash-256-v1");
  });
});
