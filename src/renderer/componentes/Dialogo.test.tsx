// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialogo, DialogoConfirmacao } from "./Dialogo";

describe("Dialogo", () => {
  it("tem role dialog nomeado, foco dentro e Esc fecha", () => {
    const fechar = vi.fn();
    render(<Dialogo titulo="Exemplo" aoFechar={fechar}><button type="button">A</button><button type="button">B</button></Dialogo>);
    const d = screen.getByRole("dialog", { name: "Exemplo" });
    expect(d.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(d, { key: "Escape" });
    expect(fechar).toHaveBeenCalledTimes(1);
  });
  it("prende o foco: Tab no último volta ao primeiro e Shift+Tab no primeiro vai ao último", () => {
    render(<Dialogo titulo="X" aoFechar={() => undefined}><button type="button">A</button><button type="button">B</button></Dialogo>);
    const d = screen.getByRole("dialog");
    const [a, b] = [screen.getByText("A"), screen.getByText("B")];
    b.focus();
    fireEvent.keyDown(d, { key: "Tab" });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(d, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(b);
  });
  it("devolve o foco a quem abriu ao fechar", () => {
    const gatilho = document.createElement("button");
    document.body.append(gatilho);
    gatilho.focus();
    const { unmount } = render(<Dialogo titulo="X" aoFechar={() => undefined}><button type="button">A</button></Dialogo>);
    unmount();
    expect(document.activeElement).toBe(gatilho);
    gatilho.remove();
  });
  it("confirmação começa em Cancelar e confirma só no clique", () => {
    const ok = vi.fn(), cancelar = vi.fn();
    render(<DialogoConfirmacao titulo="T" texto="t" rotuloConfirmar="Sim" aoConfirmar={ok} aoCancelar={cancelar} />);
    expect(document.activeElement).toBe(screen.getByText("Cancelar"));
    expect(ok).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Sim"));
    expect(ok).toHaveBeenCalled();
  });
});
