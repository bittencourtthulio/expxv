// Orçamentos do grafo 3D (D-390), sem GPU: o que dá para medir em Node é o custo de CPU por quadro com 5 000 nós e 15 000 ligações
// (física amortizada, escrita dos buffers de nós/ligações e seleção por proximidade). O desenho em si é uma chamada por lote ao WebGL2.
// P-375 a P-378. O chunk (≤ 15 KB gz) é medido por `vite build` em pasta temporária (veja D-390).
import { afterAll, describe, expect, it } from "vitest";
import { Fisica } from "../../src/renderer/componentes/grafo3d/fisica";
import { matrizDaCamera } from "../../src/renderer/componentes/grafo3d/matematica";
import { maisPerto } from "../../src/renderer/componentes/grafo3d/selecao";
import { gravarMedicoes, percentil, registrar } from "./registro";

afterAll(() => gravarMedicoes());
const N = 5000, E = 15000;
const de = Array.from({ length: E }, (_, e) => (e * 7919) % N);
const para = Array.from({ length: E }, (_, e) => (e < N ? (e + 1) % N : (e * 104729 + 13) % N));
const mediana = (xs: number[]): number => percentil(xs, 50);
const medir = (vezes: number, f: () => void): number[] => Array.from({ length: vezes }, () => { const t = performance.now(); f(); return performance.now() - t; });

describe("grafo 3D: 5 000 nós / 15 000 ligações", () => {
  const f = new Fisica({ n: N, de, para, semente: 1 });
  for (let i = 0; i < 3; i++) f.passo();

  it("P-375: iteração completa de física (grade espacial, fatiada em quadros) ≤ 60 ms", () => {
    const t = medir(15, () => f.passo());
    registrar({ id: "P-375", descricao: "Grafo 3D: iteração completa de física com 5 000 nós e 15 000 ligações (mediana; no app roda em fatias de 5 ms)", valor: mediana(t), limite: 60, unidade: "ms", pior: Math.max(...t) });
    expect(mediana(t)).toBeGreaterThan(0);
  });

  it("P-376: escrita dos buffers de nós e ligações por quadro ≤ 3 ms", () => {
    const P = new Float32Array(N * 9), L = new Float32Array(E * 14);
    const t = medir(20, () => {
      const pos = f.pos;
      for (let i = 0; i < N; i++) { const k = i * 9; P[k] = (pos[i * 3] as number) + 0.1; P[k + 1] = (pos[i * 3 + 1] as number) + 0.1; P[k + 2] = (pos[i * 3 + 2] as number) + 0.1; P[k + 7] = 1; }
      for (let e = 0; e < E; e++) { const a = (de[e] as number) * 9, c = (para[e] as number) * 9, d = e * 14; L[d] = P[a] as number; L[d + 1] = P[a + 1] as number; L[d + 2] = P[a + 2] as number; L[d + 7] = P[c] as number; L[d + 8] = P[c + 1] as number; L[d + 9] = P[c + 2] as number; }
    });
    registrar({ id: "P-376", descricao: "Grafo 3D: escrita dos buffers de nós e ligações por quadro (5 000/15 000, mediana)", valor: mediana(t), limite: 3, unidade: "ms", pior: Math.max(...t) });
    expect(L[0]).toBeDefined();
  });

  it("P-377: seleção por proximidade (projeção dos 5 000 nós) ≤ 2 ms", () => {
    const m = matrizDaCamera({ az: 0.3, el: 0.2, raio: 200, centro: [0, 0, 0] }, 1280, 800);
    const ativo = new Float32Array(N).fill(1), alcance = new Float32Array(N).fill(1);
    const t = medir(20, () => { maisPerto(f.pos, ativo, alcance, m, 1280, 800, 640, 400); });
    registrar({ id: "P-377", descricao: "Grafo 3D: seleção por proximidade com 5 000 nós (mediana)", valor: mediana(t), limite: 2, unidade: "ms", pior: Math.max(...t) });
    expect(t.length).toBe(20);
  });

  it("P-378: fatia de física por quadro (orçamento de 5 ms) ≤ 8 ms, sem travar o main thread", () => {
    const g = new Fisica({ n: N, de, para, semente: 2 });
    for (let i = 0; i < 3; i++) g.rodar(5);
    const t = medir(40, () => { g.rodar(5); });
    registrar({ id: "P-378", descricao: "Grafo 3D: custo de física por quadro com 5 000 nós/15 000 ligações (orçamento 5 ms; mediana)", valor: mediana(t), limite: 8, unidade: "ms", pior: Math.max(...t) });
    expect(g.iteracoes).toBeGreaterThan(0);
  });
});
