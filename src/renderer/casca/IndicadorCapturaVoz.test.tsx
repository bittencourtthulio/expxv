// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventoCapturaIpc, EventoVozIpc } from "../../compartilhado/captura";
import { IndicadorCapturaVoz } from "./IndicadorCapturaVoz";

afterEach(() => { cleanup(); delete (globalThis as { ade?: unknown }).ade; });

function instalarAde() {
  const ouvintes: { voz: ((e: EventoVozIpc) => void)[]; captura: ((e: EventoCapturaIpc) => void)[] } = { voz: [], captura: [] };
  const desligar = vi.fn();
  (globalThis as { ade?: unknown }).ade = {
    voz: { assinar: (cb: (e: EventoVozIpc) => void) => { ouvintes.voz.push(cb); return desligar; } },
    captura: { assinar: (cb: (e: EventoCapturaIpc) => void) => { ouvintes.captura.push(cb); return desligar; } },
  };
  return { ouvintes, desligar };
}

describe("indicadores do rodapé", () => {
  it("ocioso: nada visível (só a região viva vazia)", () => {
    instalarAde();
    render(<IndicadorCapturaVoz />);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("'● mic' aparece SÓ enquanto grava e some ao transcrever", async () => {
    const { ouvintes } = instalarAde();
    render(<IndicadorCapturaVoz />);
    await act(async () => { ouvintes.voz[0]!({ tipo: "estado", sequencia: 1, ditado: "gravando" }); });
    expect(screen.getByRole("status").textContent).toBe("● mic");
    await act(async () => { ouvintes.voz[0]!({ tipo: "estado", sequencia: 2, ditado: "transcrevendo" }); });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("quadros: contador `● 12/60 · 2 fps` até o fim da gravação", async () => {
    const { ouvintes } = instalarAde();
    render(<IndicadorCapturaVoz />);
    await act(async () => { ouvintes.captura[0]!({ tipo: "quadros_progresso", quadros: 12, maximo: 60, decorrido_ms: 6000, fps: 2 }); });
    expect(screen.getByRole("status").textContent).toBe("● 12/60 · 2 fps");
    await act(async () => { ouvintes.captura[0]!({ tipo: "quadros_fim", captura_id: null, motivo: "parou", instrucao: null }); });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("fora do Electron não assina nada e não quebra; desmontar solta as assinaturas", () => {
    render(<IndicadorCapturaVoz />);
    expect(screen.getByRole("status").textContent).toBe("");
    cleanup();
    const { desligar } = instalarAde();
    const { unmount } = render(<IndicadorCapturaVoz />);
    unmount();
    expect(desligar).toHaveBeenCalledTimes(2);
  });
});
