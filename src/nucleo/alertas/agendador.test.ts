import { describe, expect, it } from "vitest";
import { relogioFalso, timersFalsos } from "../../../tests/fixtures/alertas/ajudas";
import { criarAgendadorVencimentos, type Vencimento } from "./agendador";

const montar = () => {
  const relogio = relogioFalso();
  const timers = timersFalsos(relogio);
  const disparos: string[] = [];
  const ag = criarAgendadorVencimentos<string>({ aoVencer: (v: Vencimento<string>) => disparos.push(v.chave), timers, relogio });
  return { relogio, timers, ag, disparos };
};

describe("agendador de vencimentos (T-20.08)", () => {
  it("200 tasks ativas => 1 timer vivo", () => {
    const { ag, timers, relogio } = montar();
    for (let i = 0; i < 200; i++) ag.agendar(`t${i}`, relogio.agora() + 1000 + i, "x");
    expect(timers.vivos()).toBe(1);
    expect(ag.timersVivos()).toBe(1);
    expect(ag.pendentes()).toBe(200);
  });
  it("relógio avançando 3 h dispara cada vencimento uma vez, na ordem", () => {
    const { ag, timers, relogio, disparos } = montar();
    const t0 = relogio.agora();
    ag.agendar("c", t0 + 3 * 60_000, "x");
    ag.agendar("a", t0 + 1 * 60_000, "x");
    ag.agendar("b", t0 + 2 * 60_000, "x");
    timers.avancarAte(t0 + 3 * 3_600_000);
    expect(disparos).toEqual(["a", "b", "c"]);
    expect(timers.vivos()).toBe(0);
    timers.avancarAte(t0 + 4 * 3_600_000);
    expect(disparos).toHaveLength(3);
  });
  it("evento que antecipa um vencimento reagenda; cancelar remove", () => {
    const { ag, timers, relogio, disparos } = montar();
    const t0 = relogio.agora();
    ag.agendar("x", t0 + 60 * 60_000, "x");
    ag.agendar("x", t0 + 1000, "x");
    timers.avancarAte(t0 + 2000);
    expect(disparos).toEqual(["x"]);
    ag.agendar("y", t0 + 9_000_000, "x");
    expect(ag.cancelar("y")).toBe(true);
    expect(timers.vivos()).toBe(0);
  });
  it("após suspensão longa, retomar() dispara os vencidos UMA vez cada (sem rajada de repetição)", () => {
    const { ag, relogio, disparos } = montar();
    const t0 = relogio.agora();
    ag.agendar("a", t0 + 1000, "x");
    ag.agendar("b", t0 + 2000, "x");
    relogio.avancar(8 * 3_600_000); // o computador dormiu e o timer nativo atrasou
    ag.retomar();
    ag.retomar();
    expect(disparos).toEqual(["a", "b"]);
  });
  it("vencimento com erro não derruba os demais; callback pode reagendar", () => {
    const relogio = relogioFalso();
    const timers = timersFalsos(relogio);
    const vistos: string[] = [];
    const ag = criarAgendadorVencimentos<number>({
      timers,
      relogio,
      aoVencer(v) {
        vistos.push(v.chave);
        if (v.chave === "ruim") throw new Error("x");
        if (v.chave === "r" && v.dado < 2) ag.agendar("r", relogio.agora() + 1000, v.dado + 1);
      },
    });
    const t0 = relogio.agora();
    ag.agendar("ruim", t0 + 100, 0);
    ag.agendar("r", t0 + 200, 0);
    timers.avancarAte(t0 + 10_000);
    expect(vistos).toEqual(["ruim", "r", "r", "r"]);
  });
  it("espera maior que 2^31-1 ms é limitada (nunca dispara antes da hora)", () => {
    const { ag, relogio, disparos, timers } = montar();
    ag.agendar("longe", relogio.agora() + 40 * 86_400_000, "x");
    timers.avancarAte(relogio.agora() + 24 * 86_400_000);
    expect(disparos).toEqual([]);
    timers.avancarAte(relogio.agora() + 30 * 86_400_000);
    expect(disparos).toEqual(["longe"]);
  });
});
