import { describe, expect, it, vi } from "vitest";
import { ehAtalhoMedidorSistema, ligarAtalhoSistema } from "./sistema-acoes";

const tecla = (p: Partial<{ key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({ key: "u", code: "KeyU", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...p });

describe("atalho do medidor", () => {
  it("⌘⌥U no mac; Ctrl+Alt+U nos demais; nunca com Shift nem sem Alt", () => {
    expect(ehAtalhoMedidorSistema(tecla({ metaKey: true, altKey: true }), true)).toBe(true);
    expect(ehAtalhoMedidorSistema(tecla({ ctrlKey: true, altKey: true }), true)).toBe(false);
    expect(ehAtalhoMedidorSistema(tecla({ ctrlKey: true, altKey: true }), false)).toBe(true);
    expect(ehAtalhoMedidorSistema(tecla({ ctrlKey: true, altKey: true, shiftKey: true }), false)).toBe(false);
    expect(ehAtalhoMedidorSistema(tecla({ ctrlKey: true }), false)).toBe(false);
    expect(ehAtalhoMedidorSistema(tecla({ ctrlKey: true, altKey: true, code: "KeyK", key: "k" }), false)).toBe(false);
  });
  it("um único ouvinte, removido ao desligar", () => {
    const alvo = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const desligar = ligarAtalhoSistema(alvo, false);
    expect(alvo.addEventListener).toHaveBeenCalledTimes(1);
    desligar();
    expect(alvo.removeEventListener).toHaveBeenCalledWith("keydown", alvo.addEventListener.mock.calls[0]![1]);
  });
});
