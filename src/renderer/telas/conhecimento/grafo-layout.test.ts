import { describe, expect, it } from "vitest";
import type { ArestaGrafo, NoGrafo } from "../../../compartilhado/conhecimento";
import { avancar, criarSimulacao, energia, fatia, posicoesDe, rodarAte } from "./grafo-layout";

const no = (id: string, extra: Partial<NoGrafo> = {}): NoGrafo => ({ id, tipo: "arquivo", rotulo: id, peso: 1, x: null, y: null, ultimo_em: "2026-10-01T00:00:00Z", mission_id: null, ...extra });
const ar = (origem: string, destino: string): ArestaGrafo => ({ origem, destino, tipo: "toca", peso: 1 });

const rede = (n: number): { nos: NoGrafo[]; arestas: ArestaGrafo[] } => ({
  nos: Array.from({ length: n }, (_, i) => no(`n${i}`)),
  arestas: Array.from({ length: n - 1 }, (_, i) => ar(`n${i}`, `n${i + 1}`)),
});

describe("layout de forças (puro)", () => {
  it("é determinístico por semente e diferente entre sementes", () => {
    const { nos, arestas } = rede(30);
    const a = criarSimulacao(nos, arestas, { semente: "s1" });
    const b = criarSimulacao(nos, arestas, { semente: "s1" });
    const c = criarSimulacao(nos, arestas, { semente: "s2" });
    rodarAte(a, { maxPassos: 50 });
    rodarAte(b, { maxPassos: 50 });
    rodarAte(c, { maxPassos: 50 });
    expect(posicoesDe(a)).toEqual(posicoesDe(b));
    expect(posicoesDe(a)).not.toEqual(posicoesDe(c));
  });

  it("estabiliza: a energia cai e o laço termina antes do teto de passos", () => {
    const { nos, arestas } = rede(60);
    const s = criarSimulacao(nos, arestas, { semente: "x" });
    avancar(s);
    const inicial = energia(s);
    const r = rodarAte(s, { maxPassos: 1500 });
    expect(r.estavel).toBe(true);
    expect(r.passos).toBeLessThan(1500);
    expect(energia(s)).toBeLessThan(inicial);
  });

  it("nós com posição salva começam nela e nó fixo não se mexe", () => {
    const nos = [no("a", { x: 100, y: -50 }), no("b", { x: -100, y: 50 }), no("c")];
    const s = criarSimulacao(nos, [ar("a", "b"), ar("b", "c")], { semente: "k", fixos: new Set(["a"]) });
    expect(posicoesDe(s).find((p) => p.id === "a")).toEqual({ id: "a", x: 100, y: -50 });
    rodarAte(s, { maxPassos: 100 });
    expect(posicoesDe(s).find((p) => p.id === "a")).toEqual({ id: "a", x: 100, y: -50 });
  });

  it("aresta com ponta ausente é ignorada; todas as coordenadas são finitas, mesmo com nós sobrepostos", () => {
    const nos = [no("a", { x: 0, y: 0 }), no("b", { x: 0, y: 0 }), no("c", { x: 0, y: 0 })];
    const s = criarSimulacao(nos, [ar("a", "zzz"), ar("a", "b")], { semente: "k" });
    rodarAte(s, { maxPassos: 200 });
    for (const p of posicoesDe(s)) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); }
    const [a, b] = [posicoesDe(s)[0]!, posicoesDe(s)[1]!];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1);
  });

  it("fatia respeita o orçamento de tempo (relógio injetado) e avança ao menos um passo", () => {
    const { nos, arestas } = rede(40);
    const s = criarSimulacao(nos, arestas, { semente: "t" });
    let t = 0;
    const r = fatia(s, 8, () => { t += 3; return t; });
    expect(r.passos).toBeGreaterThanOrEqual(1);
    expect(r.passos).toBeLessThanOrEqual(4);
  });

  it("1000 nós avançam um passo em tempo razoável (Barnes-Hut, não O(n²) puro)", () => {
    const { nos, arestas } = rede(1000);
    const s = criarSimulacao(nos, arestas, { semente: "g" });
    const t0 = performance.now();
    avancar(s);
    expect(performance.now() - t0).toBeLessThan(400);
  });

  it("grafo vazio e de um nó não quebram", () => {
    expect(rodarAte(criarSimulacao([], [], { semente: "v" }), { maxPassos: 5 }).estavel).toBe(true);
    const u = criarSimulacao([no("u")], [], { semente: "v" });
    rodarAte(u, { maxPassos: 50 });
    expect(posicoesDe(u)).toHaveLength(1);
  });
});
