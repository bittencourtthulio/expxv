import { describe, expect, it } from "vitest";
import { criarDetectorCargaAlta, deveAmostrar, type EstadoJanelaSistema } from "./politica";

const j = (p: Partial<EstadoJanelaSistema> = {}): EstadoJanelaSistema => ({ visivel: true, minimizada: false, focada: true, desfocadaDesde: null, ...p });

describe("política de pausa", () => {
  it("sem assinante nunca amostra", () => expect(deveAmostrar(false, j(), 0)).toBe(false));
  it("visível e focada amostra", () => expect(deveAmostrar(true, j(), 0)).toBe(true));
  it("oculta ou minimizada pausa na hora", () => {
    expect(deveAmostrar(true, j({ visivel: false }), 0)).toBe(false);
    expect(deveAmostrar(true, j({ minimizada: true }), 0)).toBe(false);
  });
  it("desfocada continua por 10 s e depois pausa por inteiro", () => {
    const d = j({ focada: false, desfocadaDesde: 1000 });
    expect(deveAmostrar(true, d, 1000 + 10_000)).toBe(true);
    expect(deveAmostrar(true, d, 1000 + 10_001)).toBe(false);
  });
});

describe("detector de carga alta (opcional)", () => {
  it("CPU ≥ 90% por 30 s contínuos dispara uma vez e rearma ao normalizar", () => {
    const d = criarDetectorCargaAlta();
    expect(d.avaliar(95, 10, 0)).toBeNull();
    expect(d.avaliar(95, 10, 29_000)).toBeNull();
    expect(d.avaliar(95, 10, 30_000)).toBe("cpu");
    expect(d.avaliar(95, 10, 60_000)).toBeNull();
    expect(d.avaliar(10, 10, 61_000)).toBeNull();
    expect(d.avaliar(95, 10, 62_000)).toBeNull();
    expect(d.avaliar(95, 10, 92_000)).toBe("cpu");
  });
  it("queda abaixo do limiar zera a contagem dos 30 s", () => {
    const d = criarDetectorCargaAlta();
    d.avaliar(95, 0, 0); d.avaliar(50, 0, 20_000);
    expect(d.avaliar(95, 0, 40_000)).toBeNull();
    expect(d.avaliar(95, 0, 70_000)).toBe("cpu");
  });
  it("RAM ≥ 92% dispara de imediato", () => expect(criarDetectorCargaAlta().avaliar(5, 92, 0)).toBe("ram"));
});
