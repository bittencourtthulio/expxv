// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PaletaComandos } from "./PaletaComandos";
import { ehAtalhoDaPaleta, PaletaGatilho, precarregarPaleta } from "./PaletaGatilho";
import type { Comando } from "../estado/paleta";

function cmds(executar = vi.fn()): Comando[] {
  return [
    { id: "a", titulo: "Ir para Início", grupo: "Navegar", executar: () => executar("a") },
    { id: "b", titulo: "Ir para Método", grupo: "Navegar", executar: () => executar("b") },
    { id: "c", titulo: "Nova Missão", grupo: "Ações", atalho: "⌘N", executar: () => executar("c") },
  ];
}

describe("PaletaComandos", () => {
  // A LATÊNCIA ("foco em até 50 ms") não é asserção de unidade: no jsdom, sob carga, ela media a máquina e não o app (flaky).
  // Ela é medida no Electron real em tests/perf/casca.perf.ts ("P-02b"). Aqui só o que é determinístico: o foco JÁ está no campo
  // quando o render síncrono termina, sem nenhum atraso agendado (nem timer nem rAF).
  it("abre com o foco no campo, de forma síncrona (sem timer nem rAF)", () => {
    const agendados = vi.spyOn(window, "setTimeout");
    const quadros = vi.spyOn(window, "requestAnimationFrame");
    render(<PaletaComandos comandos={cmds()} aoFechar={() => {}} />);
    const campo = screen.getByRole("combobox");
    expect(document.activeElement).toBe(campo);
    expect(agendados).not.toHaveBeenCalled();
    expect(quadros).not.toHaveBeenCalled();
    agendados.mockRestore();
    quadros.mockRestore();
    expect(screen.getByRole("dialog", { name: "Paleta de comandos" })).toBeTruthy();
  });

  it("setas, Enter executam e fecham; Esc fecha", () => {
    const executar = vi.fn();
    const fechar = vi.fn();
    render(<PaletaComandos comandos={cmds(executar)} aoFechar={fechar} />);
    const campo = screen.getByRole("combobox");
    fireEvent.keyDown(campo, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(executar).toHaveBeenCalledWith("b");
    expect(fechar).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(campo, { key: "Escape" });
    expect(fechar).toHaveBeenCalledTimes(2);
  });

  it("digitar filtra (sem acento) e sem resultado explica o próximo passo", () => {
    render(<PaletaComandos comandos={cmds()} aoFechar={() => {}} />);
    const campo = screen.getByRole("combobox");
    fireEvent.change(campo, { target: { value: "missao" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("Nova Missão")]);
    fireEvent.change(campo, { target: { value: "zzzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/Nenhum comando/)).toBeTruthy();
  });

  it("foco preso (Tab não sai do campo) e devolvido a quem abriu ao fechar", () => {
    const botao = document.createElement("button");
    document.body.appendChild(botao);
    botao.focus();
    const { unmount } = render(<PaletaComandos comandos={cmds()} aoFechar={() => {}} />);
    const campo = screen.getByRole("combobox");
    fireEvent.keyDown(campo, { key: "Tab" });
    expect(document.activeElement).toBe(campo);
    unmount();
    expect(document.activeElement).toBe(botao);
    botao.remove();
  });
});

describe("atalho e gatilho", () => {
  const ev = (o: Partial<KeyboardEventInit> & { key: string }) => ({ code: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });
  it("⌘K no mac; Ctrl+Shift+P no Windows/Linux; Ctrl+K e Ctrl+P puros ficam para o terminal", () => {
    expect(ehAtalhoDaPaleta(ev({ key: "k", metaKey: true }), true)).toBe(true);
    expect(ehAtalhoDaPaleta(ev({ key: "k", ctrlKey: true }), true)).toBe(false);
    expect(ehAtalhoDaPaleta(ev({ key: "P", ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(ehAtalhoDaPaleta(ev({ key: "k", ctrlKey: true }), false)).toBe(false);
    expect(ehAtalhoDaPaleta(ev({ key: "p", ctrlKey: true }), false)).toBe(false);
  });

  it("abre pelo atalho (chunk pré-carregado) com o foco no campo e fecha com Esc", async () => {
    await precarregarPaleta();
    render(<PaletaGatilho />);
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: mac ? "k" : "p", code: mac ? "KeyK" : "KeyP", metaKey: mac, ctrlKey: !mac, shiftKey: !mac, bubbles: true, cancelable: true }));
    });
    // latência (≤ 50 ms) medida no Electron real: tests/perf/casca.perf.ts "P-02b"
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
