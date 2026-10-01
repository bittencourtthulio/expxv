import { describe, expect, it, vi } from "vitest";
import { aoPedirAcao, aoPedirTela, pedirAcao, pedirTela, VALIDADE_PEDIDO_MS } from "./navegacao";

describe("gancho de navegação", () => {
  it("entrega o pedido a quem escuta e para depois de cancelar", () => {
    const o = vi.fn();
    const cancelar = aoPedirTela(o);
    pedirTela("metodo");
    cancelar();
    pedirTela("missoes");
    expect(o).toHaveBeenCalledTimes(1);
    expect(o).toHaveBeenCalledWith("metodo");
  });
  it("sem ouvinte não faz nada", () => {
    expect(() => pedirTela("config")).not.toThrow();
  });
});

describe("ações entre telas (pedirAcao / aoPedirAcao)", () => {
  it("entrega só a quem escuta aquela ação e para depois de cancelar", () => {
    const missao = vi.fn();
    const terminal = vi.fn();
    const c1 = aoPedirAcao("nova-missao", missao);
    const c2 = aoPedirAcao("novo-terminal", terminal);
    pedirAcao("nova-missao");
    expect(missao).toHaveBeenCalledTimes(1);
    expect(terminal).not.toHaveBeenCalled();
    c1(); c2();
    pedirAcao("nova-missao");
    expect(missao).toHaveBeenCalledTimes(1);
    pendentes_limpar();
  });
  it("pedido feito antes de a tela montar (lazy) é entregue ao primeiro ouvinte, uma única vez", () => {
    pedirAcao("novo-terminal");
    const o = vi.fn();
    const cancelar = aoPedirAcao("novo-terminal", o);
    expect(o).toHaveBeenCalledTimes(1);
    cancelar();
    const outro = vi.fn();
    aoPedirAcao("novo-terminal", outro)();
    expect(outro).not.toHaveBeenCalled();
  });
  it("pedido pendente expira (não abre o wizard minutos depois)", () => {
    vi.useFakeTimers();
    try {
      pedirAcao("nova-missao");
      vi.advanceTimersByTime(VALIDADE_PEDIDO_MS + 1);
      const o = vi.fn();
      aoPedirAcao("nova-missao", o)();
      expect(o).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("ação de uma tela não fica pendente para a outra", () => {
    pedirAcao("nova-missao");
    const o = vi.fn();
    aoPedirAcao("novo-terminal", o)();
    expect(o).not.toHaveBeenCalled();
    aoPedirAcao("nova-missao", () => undefined)(); // consome o pendente
  });
});

function pendentes_limpar(): void {
  aoPedirAcao("nova-missao", () => undefined)();
  aoPedirAcao("novo-terminal", () => undefined)();
}
