import { afterEach, describe, expect, it, vi } from "vitest";
import { aoPedirTela } from "./navegacao";
import { VALIDADE_PEDIDO_OPENROUTER_MS, aoPedirOpenRouter, pedirOpenRouter } from "./openrouter-acoes";

afterEach(() => vi.useRealTimers());
describe("pedidos da paleta para o OpenRouter", () => {
  it("navega para Provedores e entrega o alvo ao ouvinte", () => {
    const telas: string[] = []; const alvos: string[] = [];
    const a = aoPedirTela((t) => telas.push(t)); const b = aoPedirOpenRouter((x) => alvos.push(x));
    pedirOpenRouter("modelos");
    expect(telas).toEqual(["provedores"]); expect(alvos).toEqual(["modelos"]);
    a(); b();
  });
  it("pedido sem ouvinte espera o primeiro (tela lazy) e expira", () => {
    vi.useFakeTimers();
    pedirOpenRouter("chave");
    const alvos: string[] = [];
    aoPedirOpenRouter((x) => alvos.push(x))();
    expect(alvos).toEqual(["chave"]);
    pedirOpenRouter("secao");
    vi.advanceTimersByTime(VALIDADE_PEDIDO_OPENROUTER_MS + 1);
    aoPedirOpenRouter((x) => alvos.push(x))();
    expect(alvos).toEqual(["chave"]);
  });
});
