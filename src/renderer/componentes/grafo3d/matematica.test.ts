import { describe, expect, it } from "vitest";
import { FOV, limitarElevacao, matrizDaCamera, multiplicar, olharPara, perspectiva, posicaoDaCamera, projetar, raioParaCaber } from "./matematica";

const cam = { az: 0, el: 0, raio: 100, centro: [0, 0, 0] as [number, number, number] };

describe("matemática do grafo 3D", () => {
  it("o centro da órbita projeta no centro da tela", () => {
    const [x, y, w] = projetar(matrizDaCamera(cam, 800, 600), 0, 0, 0, 800, 600) as number[];
    expect(x).toBeCloseTo(400, 3); expect(y).toBeCloseTo(300, 3); expect(w).toBeCloseTo(100, 3);
  });
  it("x do mundo vai para a direita e y para cima (y de tela cresce para baixo)", () => {
    const m = matrizDaCamera(cam, 800, 600);
    const direita = projetar(m, 10, 0, 0, 800, 600) as number[];
    const cima = projetar(m, 0, 10, 0, 800, 600) as number[];
    expect(direita[0]).toBeGreaterThan(400); expect(cima[1]).toBeLessThan(300);
  });
  it("ponto atrás da câmera tem profundidade <= 0", () => {
    expect((projetar(matrizDaCamera(cam, 800, 600), 0, 0, 500, 800, 600) as number[])[2]).toBeLessThanOrEqual(0);
  });
  it("a distância na tela encolhe com a profundidade (perspectiva)", () => {
    const perto = projetar(matrizDaCamera({ ...cam, raio: 50 }, 800, 600), 10, 0, 0, 800, 600) as number[];
    const longe = projetar(matrizDaCamera({ ...cam, raio: 200 }, 800, 600), 10, 0, 0, 800, 600) as number[];
    expect((perto[0] as number) - 400).toBeGreaterThan((longe[0] as number) - 400);
  });
  it("posição orbital respeita raio e elevação; multiplicar com a identidade preserva", () => {
    const p = posicaoDaCamera({ az: 1, el: 0.5, raio: 40, centro: [1, 2, 3] });
    expect(Math.hypot(p[0] - 1, p[1] - 2, p[2] - 3)).toBeCloseTo(40, 5);
    const id = new Float32Array(16); [0, 5, 10, 15].forEach((i) => { id[i] = 1; });
    const m = perspectiva(FOV, 1.5, 1, 100);
    expect([...multiplicar(m, id)]).toEqual([...m]);
    expect(Math.abs([...olharPara([0, 0, 5], [0, 0, 0])][14] as number + 5)).toBeLessThan(1e-6);
  });
  it("limita a elevação e calcula o raio que cabe a esfera", () => {
    expect(limitarElevacao(5)).toBeLessThan(1.5); expect(limitarElevacao(-5)).toBeGreaterThan(-1.5);
    expect(raioParaCaber(60, 1) * Math.sin(FOV / 2)).toBeCloseTo(60, 5);
  });
});
