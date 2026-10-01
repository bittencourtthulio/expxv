import { describe, expect, it, vi } from "vitest";
import { criarBarramento } from "./barramento";
import type { Agendador } from "./barramento";

function agendadorFalso() {
  const tarefas: Array<{ id: number; fn: () => void; ativa: boolean }> = [];
  const agendador: Agendador = {
    setTimeout: (fn) => {
      const t = { id: tarefas.length, fn, ativa: true };
      tarefas.push(t);
      return t.id;
    },
    clearTimeout: (id) => {
      const t = tarefas[id as number];
      if (t) t.ativa = false;
    },
  };
  return { agendador, correr: () => tarefas.filter((t) => t.ativa).forEach((t) => ((t.ativa = false), t.fn())) };
}

describe("barramento", () => {
  it("entrega aos assinantes e permite cancelar", () => {
    const b = criarBarramento();
    const a = vi.fn();
    const cancelar = b.assinar("pane.spawned", a);
    b.emitir("pane.spawned", 1);
    cancelar();
    b.emitir("pane.spawned", 2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(1);
  });

  it("um ouvinte que lança não derruba os demais", () => {
    const b = criarBarramento();
    const ok = vi.fn();
    b.assinar("x", () => {
      throw new Error("x");
    });
    b.assinar("x", ok);
    b.emitir("x", 1);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("coalescência: rajada vira uma entrega com o último payload", () => {
    const { agendador, correr } = agendadorFalso();
    const b = criarBarramento(agendador);
    const ouvinte = vi.fn();
    b.assinar("method.changed", ouvinte);
    for (let i = 1; i <= 50; i++) b.emitirCoalescido("method.changed", "ws1", i, 300);
    expect(b.pendentes()).toBe(1);
    expect(ouvinte).not.toHaveBeenCalled();
    correr();
    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(ouvinte).toHaveBeenCalledWith(50);
    expect(b.pendentes()).toBe(0);
  });

  it("chaves diferentes não se misturam e descarregar entrega na hora", () => {
    const { agendador } = agendadorFalso();
    const b = criarBarramento(agendador);
    const ouvinte = vi.fn();
    b.assinar("method.changed", ouvinte);
    b.emitirCoalescido("method.changed", "a", "A", 300);
    b.emitirCoalescido("method.changed", "b", "B", 300);
    expect(b.pendentes()).toBe(2);
    b.descarregar();
    expect(ouvinte.mock.calls.map((c) => c[0]).sort()).toEqual(["A", "B"]);
  });
});
