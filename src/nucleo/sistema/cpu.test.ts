import { describe, expect, it } from "vitest";
import { temposDe, usoCpu } from "./cpu";

const t = (ocioso: number, total: number) => ({ ocioso, total });

describe("uso de CPU por delta", () => {
  it("primeira amostra (sem leitura anterior) não mede", () => {
    expect(usoCpu(null, [t(10, 20)])).toBeNull();
    expect(usoCpu([], [t(10, 20)])).toBeNull();
  });
  it("calcula total e por núcleo em inteiros", () => {
    const antes = [t(100, 200), t(100, 200)];
    const depois = [t(150, 300), t(100, 300)]; // núcleo 0: 50 ocioso de 100 = 50%; núcleo 1: 0 ocioso de 100 = 100%
    expect(usoCpu(antes, depois)).toEqual({ total: 75, nucleos: [50, 100] });
  });
  it("total é ponderado pelos deltas (não média de médias)", () => {
    const r = usoCpu([t(0, 0), t(0, 0)], [t(0, 100), t(900, 900)])!;
    expect(r.nucleos).toEqual([100, 0]);
    expect(r.total).toBe(10);
  });
  it("contador que recuou (wrap/reinício) vale 0 naquele núcleo e fica fora do total", () => {
    const r = usoCpu([t(500, 1000), t(0, 0)], [t(10, 20), t(50, 100)])!;
    expect(r.nucleos).toEqual([0, 50]);
    expect(r.total).toBe(50);
  });
  it("número de núcleos diferente = não mede; sem avanço = 0", () => {
    expect(usoCpu([t(1, 2)], [t(1, 2), t(1, 2)])).toBeNull();
    expect(usoCpu([t(5, 10)], [t(5, 10)])).toEqual({ total: 0, nucleos: [0] });
  });
  it("temposDe soma user+nice+sys+idle+irq", () => {
    expect(temposDe([{ times: { user: 1, nice: 2, sys: 3, idle: 4, irq: 5 } }])).toEqual([{ ocioso: 4, total: 15 }]);
  });
});
