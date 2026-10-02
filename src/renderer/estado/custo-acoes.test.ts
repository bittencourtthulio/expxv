import { describe, expect, it, vi } from "vitest";
import { aoPedirCusto, pedirCusto } from "./custo-acoes";
import { aoPedirTela } from "./navegacao";

describe("pedidos de custo", () => {
  it("pedido antes de a tela montar espera o primeiro ouvinte e leva à tela certa", () => {
    const tela = vi.fn();
    const cancelarTela = aoPedirTela(tela);
    pedirCusto("detalhe");
    expect(tela).toHaveBeenCalledWith("consumo");
    const o = vi.fn();
    const sair = aoPedirCusto(["detalhe", "board"], o);
    expect(o).toHaveBeenCalledWith("detalhe");
    pedirCusto("board");
    expect(tela).toHaveBeenLastCalledWith("missoes");
    expect(o).toHaveBeenLastCalledWith("board");
    // outra tela montada que trata só "fontes" não consome o pedido de "detalhe"
    const so = vi.fn();
    const sairOutra = aoPedirCusto(["fontes"], so);
    pedirCusto("detalhe");
    expect(so).not.toHaveBeenCalled();
    sairOutra();
    sair();
    cancelarTela();
  });
});
