// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { criarStoreExecucaoMetodo } from "../estado/execucao-metodo";
import { FaixaExecutando } from "./FaixaExecutando";

afterEach(cleanup);
const criar = () => {
  const metodo = vi.fn();
  const s = criarStoreExecucaoMetodo({ irParaSessao: () => undefined, irParaTerminais: () => undefined, irParaMetodo: metodo, config: () => undefined, armazem: () => undefined });
  return { s, metodo };
};

describe("FaixaExecutando", () => {
  it("nada sem execução; mostra o gesto e o resumo do pedido do workspace atual", () => {
    const { s } = criar();
    render(<FaixaExecutando workspaceId="w1" store={s} />);
    expect(screen.queryByText(/Executando/)).toBeNull();
    act(() => { s.registrar({ ok: true, pane_id: "p1", comando: "c", motivo: null, sessao_id: "s1" }, { workspaceId: "w1", rotulo: "Nova feature", pedido: "exportar PDF" }); });
    expect(screen.getByRole("status").textContent).toContain("Executando: Nova feature");
    expect(screen.getByRole("status").textContent).toContain("“exportar PDF”");
  });
  it("não aparece em outro workspace; Voltar ao Método navega e Dispensar some", () => {
    const { s, metodo } = criar();
    act(() => { s.registrar({ ok: true, pane_id: "p1", comando: "c", motivo: null }, { workspaceId: "w1", rotulo: "X" }); });
    const { rerender } = render(<FaixaExecutando workspaceId="w2" store={s} />);
    expect(screen.queryByText(/Executando/)).toBeNull();
    rerender(<FaixaExecutando workspaceId="w1" store={s} />);
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao Método" }));
    expect(metodo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Dispensar a faixa" }));
    expect(screen.queryByText(/Executando/)).toBeNull();
  });
});
