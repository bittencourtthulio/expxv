import { describe, expect, it, vi } from "vitest";
import { aoPedirSecaoConfig, aoPedirTela, consumirSecaoConfigPedida, pedirConfiguracoes } from "./navegacao";

describe("pedirConfiguracoes", () => {
  it("abre a tela de configurações e deixa a seção pendente para a tela que ainda vai montar", () => {
    const tela = vi.fn();
    const desfazer = aoPedirTela(tela);
    pedirConfiguracoes("voz");
    expect(tela).toHaveBeenCalledWith("config");
    expect(consumirSecaoConfigPedida()).toBe("voz");
    expect(consumirSecaoConfigPedida()).toBeNull(); // consumido uma vez só
    desfazer();
  });

  it("avisa a tela já montada pelo ouvinte", () => {
    const ouvinte = vi.fn();
    const desfazer = aoPedirSecaoConfig(ouvinte);
    pedirConfiguracoes("voz");
    expect(ouvinte).toHaveBeenCalledWith("voz");
    consumirSecaoConfigPedida();
    desfazer();
  });

  it("pedido velho expira e a tela abre na seção padrão", () => {
    vi.useFakeTimers();
    pedirConfiguracoes("voz");
    vi.advanceTimersByTime(10_000);
    expect(consumirSecaoConfigPedida()).toBeNull();
    vi.useRealTimers();
  });
});
