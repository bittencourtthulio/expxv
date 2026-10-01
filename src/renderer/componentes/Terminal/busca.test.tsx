// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BuscaTerminal, ehAtalhoDeBusca, type MotorBusca } from "./busca";

const motor = (): MotorBusca => ({ findNext: vi.fn(() => true), findPrevious: vi.fn(() => true), clearDecorations: vi.fn() });
const tecla = (init: Partial<KeyboardEventInit> & { key: string }) => ({ type: "keydown", altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, ...init }) as never;

describe("ehAtalhoDeBusca", () => {
  it("mac: Cmd+F; Ctrl+F segue para o processo", () => {
    expect(ehAtalhoDeBusca(tecla({ key: "f", metaKey: true }), true)).toBe(true);
    expect(ehAtalhoDeBusca(tecla({ key: "f", ctrlKey: true }), true)).toBe(false);
  });
  it("demais: Ctrl+Shift+F; Ctrl+F puro e Cmd+F não", () => {
    expect(ehAtalhoDeBusca(tecla({ key: "F", ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(ehAtalhoDeBusca(tecla({ key: "f", ctrlKey: true }), false)).toBe(false);
    expect(ehAtalhoDeBusca(tecla({ key: "f", metaKey: true }), false)).toBe(false);
  });
});

describe("BuscaTerminal", () => {
  it("expõe role=search, foca o campo, Enter avança e Shift+Enter volta", () => {
    const m = motor();
    render(<BuscaTerminal busca={m} aoFechar={() => undefined} />);
    expect(screen.getByRole("search")).toBeTruthy();
    const campo = screen.getByLabelText("Termo de busca");
    expect(document.activeElement).toBe(campo);
    fireEvent.change(campo, { target: { value: "erro" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    fireEvent.keyDown(campo, { key: "Enter", shiftKey: true });
    expect(m.findNext).toHaveBeenCalledTimes(2);
    expect(m.findPrevious).toHaveBeenCalledTimes(1);
  });
  it("Esc fecha (devolve o foco a quem chamou) e termo vazio limpa o destaque", () => {
    const m = motor();
    const fechar = vi.fn();
    render(<BuscaTerminal busca={m} aoFechar={fechar} />);
    const campo = screen.getByLabelText("Termo de busca");
    fireEvent.change(campo, { target: { value: "a" } });
    fireEvent.change(campo, { target: { value: "" } });
    expect(m.clearDecorations).toHaveBeenCalled();
    fireEvent.keyDown(campo, { key: "Escape" });
    expect(fechar).toHaveBeenCalledTimes(1);
  });
});
