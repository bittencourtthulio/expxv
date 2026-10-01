import { afterEach, describe, expect, it, vi } from "vitest";
import { agendarCargaOciosa, definirCarregadorDoTerminal, precarregarTerminal, type ModuloTerminal } from "./carga";

afterEach(() => definirCarregadorDoTerminal());
const modulo = {} as ModuloTerminal;

describe("precarregarTerminal", () => {
  it("memoiza: vários pedidos fazem um import só", async () => {
    const carregador = vi.fn().mockResolvedValue(modulo);
    definirCarregadorDoTerminal(carregador);
    await Promise.all([precarregarTerminal(), precarregarTerminal()]);
    expect(carregador).toHaveBeenCalledTimes(1);
  });
  it("falha libera nova tentativa", async () => {
    const carregador = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(modulo);
    definirCarregadorDoTerminal(carregador);
    await expect(precarregarTerminal()).rejects.toThrow();
    await expect(precarregarTerminal()).resolves.toBe(modulo);
    expect(carregador).toHaveBeenCalledTimes(2);
  });
});

describe("agendarCargaOciosa", () => {
  it("usa requestIdleCallback e só carrega quando o navegador o chama", () => {
    const carregador = vi.fn().mockResolvedValue(modulo);
    definirCarregadorDoTerminal(carregador);
    let cb: (() => void) | null = null;
    agendarCargaOciosa({ requestIdleCallback: (f) => { cb = f; return 1; } });
    expect(carregador).not.toHaveBeenCalled();
    cb!();
    expect(carregador).toHaveBeenCalledTimes(1);
  });
  it("sem requestIdleCallback cai em timer e o cancelamento impede a carga", () => {
    vi.useFakeTimers();
    try {
      const carregador = vi.fn().mockResolvedValue(modulo);
      definirCarregadorDoTerminal(carregador);
      const cancelar = agendarCargaOciosa({});
      cancelar();
      vi.advanceTimersByTime(1000);
      expect(carregador).not.toHaveBeenCalled();
      agendarCargaOciosa({});
      vi.advanceTimersByTime(1000);
      expect(carregador).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
