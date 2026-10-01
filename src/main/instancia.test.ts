import { describe, expect, it, vi } from "vitest";
import { tratarSegundaInstancia } from "./instancia";

function janela(op: { destruida?: boolean; minimizada?: boolean } = {}) {
  return {
    isDestroyed: () => op.destruida ?? false,
    isMinimized: () => op.minimizada ?? false,
    restore: vi.fn(),
    focus: vi.fn(),
  };
}

describe("segunda instância", () => {
  it("foca a janela existente e restaura se minimizada", () => {
    const j = janela({ minimizada: true });
    const reabrir = vi.fn();
    tratarSegundaInstancia({ janela: j, reabrirJanela: reabrir });
    expect(j.restore).toHaveBeenCalled();
    expect(j.focus).toHaveBeenCalled();
    expect(reabrir).not.toHaveBeenCalled();
  });

  it("recria a janela quando não há janela viva", () => {
    const reabrir = vi.fn();
    tratarSegundaInstancia({ janela: null, reabrirJanela: reabrir });
    tratarSegundaInstancia({ janela: janela({ destruida: true }), reabrirJanela: reabrir });
    expect(reabrir).toHaveBeenCalledTimes(2);
  });
});
