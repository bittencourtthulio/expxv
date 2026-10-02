// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ehAtalhoAdicionarWorkspace, ligarAtalhoAdicionarWorkspace } from "./adicionar-workspace-acoes";

const tecla = (o: Partial<KeyboardEventInit> & { key: string }) => new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...o });

describe("atalho do modal Adicionar workspace", () => {
  it("mac: ⌘⇧O; Windows/Linux: Ctrl+Shift+O; nunca ⌘O puro (que é o diálogo direto) nem com Alt", () => {
    expect(ehAtalhoAdicionarWorkspace({ key: "O", code: "KeyO", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, true)).toBe(true);
    expect(ehAtalhoAdicionarWorkspace({ key: "o", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, true)).toBe(false);
    expect(ehAtalhoAdicionarWorkspace({ key: "O", metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }, true)).toBe(false);
    expect(ehAtalhoAdicionarWorkspace({ key: "O", code: "KeyO", metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }, false)).toBe(true);
    expect(ehAtalhoAdicionarWorkspace({ key: "O", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, false)).toBe(false);
    expect(ehAtalhoAdicionarWorkspace({ key: "O", metaKey: true, ctrlKey: false, shiftKey: true, altKey: true }, true)).toBe(false);
    expect(ehAtalhoAdicionarWorkspace({ key: "p", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, true)).toBe(false);
  });
  it("captura o teclado (vale dentro do terminal), abre o modal na seção Abrir pasta e some ao desligar", () => {
    const store = { abrir: vi.fn() };
    const desligar = ligarAtalhoAdicionarWorkspace(store, window, true);
    const e = tecla({ key: "O", code: "KeyO", metaKey: true, shiftKey: true });
    window.dispatchEvent(e);
    expect(store.abrir).toHaveBeenCalledWith("pasta");
    expect(e.defaultPrevented).toBe(true);
    window.dispatchEvent(tecla({ key: "O", code: "KeyO", metaKey: true, shiftKey: true, repeat: true }));
    window.dispatchEvent(tecla({ key: "o", code: "KeyO", metaKey: true }));
    expect(store.abrir).toHaveBeenCalledTimes(1);
    desligar();
    window.dispatchEvent(tecla({ key: "O", code: "KeyO", metaKey: true, shiftKey: true }));
    expect(store.abrir).toHaveBeenCalledTimes(1);
  });
});
