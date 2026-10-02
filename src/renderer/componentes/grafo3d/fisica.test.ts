import { describe, expect, it } from "vitest";
import { Fisica, LIMIAR_PARES, comprimentoDaMola } from "./fisica";

const cadeia = (n: number) => ({ de: Array.from({ length: n - 1 }, (_, i) => i), para: Array.from({ length: n - 1 }, (_, i) => i + 1) });
const dist = (f: Fisica, a: number, b: number): number => Math.hypot((f.pos[a * 3] as number) - (f.pos[b * 3] as number), (f.pos[a * 3 + 1] as number) - (f.pos[b * 3 + 1] as number), (f.pos[a * 3 + 2] as number) - (f.pos[b * 3 + 2] as number));

describe("física 3D", () => {
  it("é determinística por semente", () => {
    const e = { n: 40, ...cadeia(40), semente: 3 };
    const a = new Fisica(e), b = new Fisica(e), c = new Fisica({ ...e, semente: 4 });
    for (let i = 0; i < 30; i++) { a.passo(); b.passo(); c.passo(); }
    expect([...a.pos]).toEqual([...b.pos]);
    expect([...a.pos]).not.toEqual([...c.pos]);
  });
  it("esfria: o calor cai até o mínimo e `rodar` para de iterar", () => {
    const f = new Fisica({ n: 30, ...cadeia(30) });
    let guarda = 0;
    while (!f.frio && guarda++ < 1000) f.rodar(1000, () => 0, 50);
    expect(f.frio).toBe(true);
    expect(f.rodar(5)).toBe(0);
    f.reaquecer(); expect(f.frio).toBe(false);
  });
  it("ligados ficam mais perto que desligados e nada vira NaN", () => {
    const f = new Fisica({ n: 20, de: [0], para: [1] });
    for (let i = 0; i < 400; i++) f.passo();
    expect([...f.pos].every(Number.isFinite)).toBe(true);
    const outros = [2, 3, 4, 5, 6].map((j) => dist(f, 0, j)).reduce((a, b) => a + b) / 5;
    expect(dist(f, 0, 1)).toBeLessThan(outros);
  });
  it("acima do limiar usa a grade e continua finito, com o raio da rede limitado", () => {
    const n = LIMIAR_PARES + 600;
    const f = new Fisica({ n, ...cadeia(n) });
    for (let i = 0; i < 60; i++) f.passo();
    expect([...f.pos].every(Number.isFinite)).toBe(true);
    expect(f.envoltoria().raio).toBeLessThan(comprimentoDaMola(n) * Math.cbrt(n) * 12);
  });
  it("respeita o orçamento: com relógio que passa do limite faz uma única iteração", () => {
    const f = new Fisica({ n: 50, ...cadeia(50) });
    let t = 0;
    expect(f.rodar(5, () => (t += 10), 50)).toBe(1);
  });
  it("nós do mesmo grupo nascem mais juntos que os de grupos diferentes", () => {
    const grupo = Int32Array.from({ length: 60 }, (_, i) => (i < 30 ? 0 : 1));
    const f = new Fisica({ n: 60, de: [], para: [], grupo, semente: 9 });
    let s = 0, q = 0;
    for (let i = 0; i < 30; i++) for (let j = i + 1; j < 30; j++) { s += dist(f, i, j); q++; }
    let entre = 0;
    for (let i = 0; i < 30; i++) entre += dist(f, i, 30 + i);
    expect(s / q).toBeLessThan(entre / 30);
  });
});
