// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EventoRastro } from "../../../nucleo/metodo/tipos";
import { Rastro } from "./Rastro";

const ev = (i: number, o: Partial<EventoRastro> = {}): EventoRastro => ({
  ts: `2026-01-01T10:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`, expx_eventos: 1, trabalho_id: "x", ferramenta: "sprintx", origem: "skill",
  evento: i % 2 === 0 ? "task_iniciada" : "task_concluida", fase: "f6", task: `T-${i}`, agente: i % 3 === 0 ? "qa" : "principal", resultado: "ok", detalhe: `detalhe ${i}`, arquivos: [], ...o,
});

function instalar(total: number) {
  const todos = Array.from({ length: total }, (_, i) => ev(i));
  const rastro = vi.fn(async (_w: string, _t: string, depois = 0) => ({ eventos: depois === 0 ? todos : [], proximo: depois === 0 ? total : depois }));
  (globalThis as unknown as { ade: unknown }).ade = { metodo: { rastro } };
  return rastro;
}
afterEach(() => { delete (globalThis as { ade?: unknown }).ade; });

describe("Rastro", () => {
  it("5 000 linhas: só as visíveis no DOM e a contagem total", async () => {
    instalar(5000);
    render(<Rastro workspaceId="w" trabalhoId="x" />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("5000 de 5000"));
    const linhas = document.querySelectorAll(".met-evento").length;
    expect(linhas).toBeGreaterThan(0);
    expect(linhas).toBeLessThan(40);
  });

  it("filtra por agente e por evento", async () => {
    instalar(30);
    render(<Rastro workspaceId="w" trabalhoId="x" />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("30 de 30"));
    fireEvent.change(screen.getByLabelText("Agente"), { target: { value: "qa" } });
    expect(screen.getByRole("status").textContent).toContain("10 de 30");
    fireEvent.change(screen.getByLabelText("Evento"), { target: { value: "task_iniciada" } });
    expect(screen.getByRole("status").textContent).toContain("5 de 30");
  });

  it("sem eventos mostra estado vazio", async () => {
    instalar(0);
    render(<Rastro workspaceId="w" trabalhoId="x" />);
    expect(await screen.findByText(/Sem eventos no rastro/)).toBeTruthy();
  });
});
