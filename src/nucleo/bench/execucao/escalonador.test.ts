import { describe, expect, it } from "vitest";
import { escalonar, limitarParalelo } from "./escalonador";

const par = (i: number, conta: string | null = null) => ({ id: `p${i}`, conta_id: conta });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = (o: Partial<Parameters<typeof escalonar>[1]> = {}): Parameters<typeof escalonar>[1] => ({ maxParalelo: 3, tetoUsd: null, sinal: new AbortController().signal, custo: () => ({ conhecido_usd: 0, algum_desconhecido: false }), executar: async () => undefined, aoPular: () => undefined, ...o });

describe("escalonador", () => {
  it("nunca passa de max_paralelo em execução e termina tudo (9 pares, paralelo 3)", async () => {
    let agora = 0, pico = 0;
    const r = await escalonar(Array.from({ length: 9 }, (_, i) => par(i)), base({ executar: async () => { agora++; pico = Math.max(pico, agora); await esperar(15); agora--; } }));
    expect(pico).toBe(3);
    expect(r.maxSimultaneo).toBe(3);
    expect(r.lancados).toBe(9);
    expect(r.pulados).toEqual([]);
  });
  it("o teto de paralelismo é 5 e o mínimo 1", () => {
    expect(limitarParalelo(99)).toBe(5);
    expect(limitarParalelo(0)).toBe(1);
    expect(limitarParalelo(NaN)).toBe(3);
  });
  it("teto_usd: para de lançar pares novos quando o custo CONHECIDO estoura", async () => {
    let gasto = 0;
    const puladosMotivo: string[] = [];
    const r = await escalonar(Array.from({ length: 6 }, (_, i) => par(i)), base({ maxParalelo: 1, tetoUsd: 1, custo: () => ({ conhecido_usd: gasto, algum_desconhecido: false }), executar: async () => { gasto += 0.6; }, aoPular: (_p, m) => void puladosMotivo.push(m) }));
    expect(r.lancados).toBe(2);
    expect(r.pulados).toHaveLength(4);
    expect(new Set(puladosMotivo)).toEqual(new Set(["teto_usd"]));
  });
  it("custo desconhecido: vale o teto de 20 execuções por Run", async () => {
    const r = await escalonar(Array.from({ length: 25 }, (_, i) => par(i)), base({ maxParalelo: 5, custo: () => ({ conhecido_usd: 0, algum_desconhecido: true }) }));
    expect(r.lancados).toBe(20);
    expect(r.pulados.every((p) => p.motivo === "limite_execucoes")).toBe(true);
    // com custo conhecido o teto de 20 não vale
    const r2 = await escalonar(Array.from({ length: 25 }, (_, i) => par(i)), base({ maxParalelo: 5 }));
    expect(r2.lancados).toBe(25);
  });
  it("conta sem limite: o par fica na fila (pulado com aviso) e a conta NUNCA é trocada", async () => {
    const usadas: Array<string | null> = [];
    const r = await escalonar([par(1, "c_cheia"), par(2, "c_ok"), par(3, null)], base({ estadoConta: (c) => (c === "c_cheia" ? "sem_limite" : "ok"), executar: async (p) => void usadas.push(p.conta_id) }));
    expect(usadas.sort()).toEqual([null, "c_ok"].sort());
    expect(r.pulados).toEqual([{ id: "p1", motivo: "sem_limite" }]);
  });
  it("cancelar durante a fila não lança nada novo", async () => {
    const ac = new AbortController();
    const lancados: string[] = [];
    const r = await escalonar(Array.from({ length: 6 }, (_, i) => par(i)), base({ maxParalelo: 1, sinal: ac.signal, executar: async (p) => { lancados.push(p.id); if (p.id === "p1") ac.abort(); await esperar(5); } }));
    expect(lancados).toEqual(["p0", "p1"]);
    expect(r.pulados.every((p) => p.motivo === "cancelado")).toBe(true);
    expect(r.pulados).toHaveLength(4);
  });
  it("erro de um par não derruba os demais", async () => {
    const r = await escalonar([par(1), par(2), par(3)], base({ executar: async (p) => { if (p.id === "p2") throw new Error("boom"); } }));
    expect(r.lancados).toBe(3);
  });
  it("lista vazia resolve na hora", async () => {
    expect((await escalonar([], base())).lancados).toBe(0);
  });
});
