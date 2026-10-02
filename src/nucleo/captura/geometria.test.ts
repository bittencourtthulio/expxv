import { describe, expect, it } from "vitest";
import { displayDaJanela, displayDoPonto, recorteFisico, retanguloDeCantos, selecaoValida, tamanhoDaMiniatura, tamanhoFisico, type DisplayInfo } from "./geometria";

const retina: DisplayInfo = { id: 1, x: 0, y: 0, largura: 1440, altura: 900, fator: 2 };
const externo: DisplayInfo = { id: 2, x: 1440, y: 0, largura: 1920, altura: 1080, fator: 1 };

describe("geometria de captura", () => {
  it("display 1440x900 com fator 2 gera miniatura 2880x1800", () => {
    expect(tamanhoFisico(retina)).toEqual({ largura: 2880, altura: 1800 });
    expect(tamanhoDaMiniatura(retina)).toEqual({ width: 2880, height: 1800 });
  });

  it("recorte lógico (100,100,300,200) vira (200,200,600,400) físico", () => {
    expect(recorteFisico(retina, { x: 100, y: 100, largura: 300, altura: 200 })).toEqual({ x: 200, y: 200, largura: 600, altura: 400 });
  });

  it("dois displays com fatores diferentes recortam certo, cada um na sua escala", () => {
    expect(recorteFisico(externo, { x: 100, y: 100, largura: 300, altura: 200 })).toEqual({ x: 100, y: 100, largura: 300, altura: 200 });
    expect(recorteFisico({ ...externo, fator: 1.5 }, { x: 10, y: 10, largura: 100, altura: 100 })).toEqual({ x: 15, y: 15, largura: 150, altura: 150 });
  });

  it("recorte é limitado ao display e seleção fora dele vira null", () => {
    expect(recorteFisico(retina, { x: 1400, y: 880, largura: 200, altura: 200 })).toEqual({ x: 2800, y: 1760, largura: 80, altura: 40 });
    expect(recorteFisico(retina, { x: 5000, y: 5000, largura: 10, altura: 10 })).toBeNull();
    expect(recorteFisico(retina, { x: Number.NaN, y: 0, largura: 10, altura: 10 })).toBeNull();
    expect(recorteFisico(retina, { x: 0, y: 0, largura: -4, altura: 10 })).toBeNull();
  });

  it("menor que 5x5 cancela; 5x5 vale", () => {
    expect(selecaoValida({ x: 0, y: 0, largura: 4, altura: 100 })).toBe(false);
    expect(selecaoValida({ x: 0, y: 0, largura: 5, altura: 5 })).toBe(true);
    expect(selecaoValida({ x: 0, y: 0, largura: Infinity, altura: 9 })).toBe(false);
  });

  it("arrasto em qualquer direção normaliza o retângulo", () => {
    expect(retanguloDeCantos({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, largura: 40, altura: 60 });
  });

  it("acha o display do ponto e da janela", () => {
    expect(displayDoPonto([retina, externo], { x: 1500, y: 10 })?.id).toBe(2);
    expect(displayDoPonto([retina, externo], { x: 100, y: 10 })?.id).toBe(1);
    expect(displayDoPonto([], { x: 0, y: 0 })).toBeNull();
    expect(displayDaJanela([retina, externo], { x: 1300, y: 0, largura: 800, altura: 600 })?.id).toBe(2);
  });
});
