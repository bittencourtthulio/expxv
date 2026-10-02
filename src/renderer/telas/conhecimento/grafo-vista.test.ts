import { describe, expect, it } from "vitest";
import { acharNo, enquadrar, mundoParaTela, raioDoNo, selecionarRotulos, telaParaMundo, zoomEm, ZOOM_MAX, ZOOM_MIN, type Camera } from "./grafo-vista";

const cam: Camera = { cx: 0, cy: 0, zoom: 1 };
const L = 800;
const A = 600;

describe("vista do grafo (puro)", () => {
  it("mundo<->tela é inversa e o centro do mundo cai no centro da tela", () => {
    const c: Camera = { cx: 40, cy: -20, zoom: 2.5 };
    expect(mundoParaTela(c, L, A, 40, -20)).toEqual([400, 300]);
    const [sx, sy] = mundoParaTela(c, L, A, 123, 45);
    const [wx, wy] = telaParaMundo(c, L, A, sx, sy);
    expect(wx).toBeCloseTo(123, 6);
    expect(wy).toBeCloseTo(45, 6);
  });

  it("zoom na roda mantém o ponto sob o cursor e respeita os limites", () => {
    const [antesX, antesY] = telaParaMundo(cam, L, A, 600, 100);
    const c = zoomEm(cam, L, A, 600, 100, 2);
    expect(c.zoom).toBe(2);
    const [dX, dY] = telaParaMundo(c, L, A, 600, 100);
    expect(dX).toBeCloseTo(antesX, 6);
    expect(dY).toBeCloseTo(antesY, 6);
    expect(zoomEm(cam, L, A, 0, 0, 1e6).zoom).toBe(ZOOM_MAX);
    expect(zoomEm(cam, L, A, 0, 0, 1e-6).zoom).toBe(ZOOM_MIN);
  });

  it("hit-test acha o nó sob o ponteiro (o mais próximo), com tolerância, e -1 fora", () => {
    const xs = new Float64Array([0, 30, 200]);
    const ys = new Float64Array([0, 0, 0]);
    const raios = new Float64Array([raioDoNo(1), raioDoNo(1), raioDoNo(1)]);
    expect(acharNo(xs, ys, raios, cam, L, A, 400, 300)).toBe(0);
    expect(acharNo(xs, ys, raios, cam, L, A, 400 + 29, 300)).toBe(1);
    expect(acharNo(xs, ys, raios, cam, L, A, 400 + 100, 300 + 100)).toBe(-1);
    expect(acharNo(new Float64Array(0), new Float64Array(0), new Float64Array(0), cam, L, A, 1, 1)).toBe(-1);
  });

  it("seleciona no máximo 250 rótulos: só visíveis, por peso, e os forçados sempre entram", () => {
    const nos = Array.from({ length: 1000 }, (_, i) => ({ id: `n${i}`, x: (i % 40) * 10 - 200, y: Math.floor(i / 40) * 10 - 120, peso: i % 97 }));
    const r = selecionarRotulos(nos, cam, L, A, 250, new Set(["n999"]));
    expect(r.length).toBeLessThanOrEqual(250);
    expect(r).toContain("n999");
    const fora = selecionarRotulos([{ id: "longe", x: 1e6, y: 0, peso: 99 }], cam, L, A, 250, new Set());
    expect(fora).toEqual([]);
  });

  it("enquadrar cobre todos os pontos; vazio volta à câmera padrão", () => {
    const c = enquadrar(new Float64Array([-100, 300]), new Float64Array([-50, 150]), L, A, 40);
    for (const [x, y] of [[-100, -50], [300, 150]] as const) {
      const [sx, sy] = mundoParaTela(c, L, A, x, y);
      expect(sx).toBeGreaterThanOrEqual(0); expect(sx).toBeLessThanOrEqual(L);
      expect(sy).toBeGreaterThanOrEqual(0); expect(sy).toBeLessThanOrEqual(A);
    }
    expect(enquadrar(new Float64Array(0), new Float64Array(0), L, A, 40)).toEqual({ cx: 0, cy: 0, zoom: 1 });
  });
});
