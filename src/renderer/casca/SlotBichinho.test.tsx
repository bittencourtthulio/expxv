// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const carregou = vi.fn();
vi.mock("../bichinho/Slot", () => { carregou(); return { default: ({ recolhido }: { recolhido: boolean }) => <div data-testid="slot" data-recolhido={String(recolhido)} /> }; });
vi.mock("../bichinho/Mini", () => ({ default: ({ workspaceId }: { workspaceId: string }) => <div data-testid="mini" data-ws={workspaceId} /> }));

import { ATRASO_BICHINHO_MS, MiniBichinho, SlotBichinho } from "./SlotBichinho";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("encaixe lazy do bichinho (nada no boot)", () => {
  it("não pede o chunk nem renderiza antes do atraso ocioso; depois renderiza o slot", async () => {
    vi.useFakeTimers();
    render(<SlotBichinho recolhido />);
    expect(screen.queryByTestId("slot")).toBeNull();
    expect(carregou).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(ATRASO_BICHINHO_MS + 50); });
    vi.useRealTimers();
    expect(await screen.findByTestId("slot")).toBeTruthy();
    expect(screen.getByTestId("slot").dataset["recolhido"]).toBe("true");
  });

  it("o mini do card segue a mesma regra e entrega o id do workspace", async () => {
    vi.useFakeTimers();
    render(<MiniBichinho workspaceId="ws_x" />);
    expect(screen.queryByTestId("mini")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(ATRASO_BICHINHO_MS + 50); });
    vi.useRealTimers();
    expect((await screen.findByTestId("mini")).dataset["ws"]).toBe("ws_x");
  });

  it("desmontar antes do atraso cancela o timer (nada vaza)", () => {
    vi.useFakeTimers();
    const { unmount } = render(<SlotBichinho recolhido={false} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
