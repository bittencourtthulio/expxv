import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { iniciarAmostrador, quadrosPrevistos, type MotivoFim } from "./quadros";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function montar(fps: 1 | 2, extra: Partial<Parameters<typeof iniciarAmostrador>[0]> = {}) {
  const gravados: number[] = [];
  const fim: { motivo: MotivoFim; quadros: number; erro: Error | null }[] = [];
  const a = iniciarAmostrador({
    fps,
    capturar: async () => new Uint8Array(4),
    gravar: async (n) => void gravados.push(n),
    aoTerminar: (r) => void fim.push(r),
    ...extra,
  });
  return { a, gravados, fim };
}

describe("amostrador de quadros", () => {
  it("5 s a 2 fps = 10 quadros (±1) e 1 fps = 5", async () => {
    const m2 = montar(2);
    await vi.advanceTimersByTimeAsync(5_000);
    m2.a.parar();
    await vi.advanceTimersByTimeAsync(50);
    expect(m2.gravados.length).toBeGreaterThanOrEqual(9);
    expect(m2.gravados.length).toBeLessThanOrEqual(11);
    expect(m2.fim).toEqual([{ motivo: "parou", quadros: m2.gravados.length, erro: null }]);
    const m1 = montar(1);
    await vi.advanceTimersByTimeAsync(5_000);
    m1.a.parar();
    await vi.advanceTimersByTimeAsync(50);
    expect(m1.gravados.length).toBeGreaterThanOrEqual(4);
    expect(m1.gravados.length).toBeLessThanOrEqual(6);
  });

  it("para sozinho no teto de quadros e de duração", async () => {
    const m = montar(2, { quadros_max: 3 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(m.fim).toEqual([{ motivo: "limite", quadros: 3, erro: null }]);
    const d = montar(2, { duracao_max_ms: 2_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(d.fim[0]?.motivo).toBe("limite");
    expect(d.gravados.length).toBeLessThanOrEqual(5);
  });

  it("falha no primeiro quadro termina como erro, com 0 quadros", async () => {
    const m = montar(2, { capturar: async () => { throw new Error("sem permissão"); } });
    await vi.advanceTimersByTimeAsync(10);
    expect(m.fim).toHaveLength(1);
    expect(m.fim[0]).toMatchObject({ motivo: "erro", quadros: 0 });
    expect(m.fim[0]?.erro?.message).toBe("sem permissão");
    const nulo = montar(1, { capturar: async () => null });
    await vi.advanceTimersByTimeAsync(10);
    expect(nulo.fim[0]?.motivo).toBe("erro");
  });

  it("backpressure: captura lenta nunca acumula captura em voo", async () => {
    let emVoo = 0;
    let pico = 0;
    const m = montar(2, {
      capturar: async () => {
        emVoo++; pico = Math.max(pico, emVoo);
        await new Promise((r) => setTimeout(r, 900));
        emVoo--;
        return new Uint8Array(1);
      },
    });
    await vi.advanceTimersByTimeAsync(6_000);
    m.a.parar();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pico).toBe(1);
    expect(m.fim).toHaveLength(1);
  });

  it("parar termina em até 1 s e só avisa uma vez", async () => {
    const m = montar(1);
    await vi.advanceTimersByTimeAsync(1_500);
    m.a.parar();
    m.a.parar();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(m.fim).toHaveLength(1);
    expect(m.a.ativo).toBe(false);
  });

  it("quadros previstos = ceil(duração × fps), limitado ao teto", () => {
    expect(quadrosPrevistos(5_000, 2)).toBe(10);
    expect(quadrosPrevistos(60_000, 2)).toBe(120);
    expect(quadrosPrevistos(90_000, 2)).toBe(120);
    expect(quadrosPrevistos(2_300, 1)).toBe(3);
  });
});
