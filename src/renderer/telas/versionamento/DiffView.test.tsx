// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffView } from "./diff/DiffView";
import { diffGrande, diffSimples } from "./teste-fixtures";

describe("DiffView", () => {
  it("mostra arquivo, hunk e linhas com sinais e números", () => {
    render(<DiffView diff={diffSimples()} />);
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    expect(screen.getByText("@@ -1,3 +1,3 @@")).toBeTruthy();
    expect(screen.getAllByText("+").length).toBeGreaterThan(0);
  });
  it("ações: estagiar hunk, estagiar só as linhas marcadas e atalho `s`", () => {
    const aoHunk = vi.fn();
    const aoLinhas = vi.fn();
    render(<DiffView diff={diffSimples()} acoes={{ sentido: "estagiar", aoHunk, aoLinhas }} />);
    fireEvent.click(screen.getByRole("button", { name: "Estagiar hunk" }));
    expect(aoHunk).toHaveBeenCalledWith(0, 0);
    fireEvent.click(screen.getAllByRole("checkbox")[1]!); // linha `+` (índice 2 em Hunk.linhas)
    fireEvent.click(screen.getByRole("button", { name: /Estagiar 1 linha/ }));
    expect(aoLinhas).toHaveBeenCalledWith(0, 0, [2]);
    aoHunk.mockClear();
    fireEvent.keyDown(screen.getByRole("region", { name: "Diff" }), { key: "j" });
    fireEvent.keyDown(screen.getByRole("region", { name: "Diff" }), { key: "s" });
    expect(aoHunk).toHaveBeenCalledWith(0, 0);
  });
  it("diff staged oferece 'Remover do stage' e o atalho `u`", () => {
    const aoHunk = vi.fn();
    render(<DiffView diff={diffSimples()} acoes={{ sentido: "desestagiar", aoHunk, aoLinhas: vi.fn() }} />);
    expect(screen.getByRole("button", { name: "Remover do stage hunk" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("region", { name: "Diff" }), { key: "u" });
    expect(aoHunk).toHaveBeenCalled();
  });
  it("lado a lado renderiza pares", () => {
    const { container } = render(<DiffView diff={diffSimples()} modo="lado" />);
    expect(container.querySelectorAll(".vc-d-par").length).toBeGreaterThan(0);
  });
  it("sem acoes não há caixas de seleção; sem diff mostra estado vazio", () => {
    const { container, rerender } = render(<DiffView diff={diffSimples()} />);
    expect(container.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
    rerender(<DiffView diff={null} />);
    expect(screen.getByText(/Selecione um arquivo/)).toBeTruthy();
  });
  it("P-18: diff de 10 000 linhas pinta só as linhas visíveis (tempo medido) e o de 1 MB não trava", async () => {
    const d10k = diffGrande(0.6); // ≈ 10 000 linhas
    let t0 = performance.now();
    const { container, unmount } = render(<DiffView diff={d10k} />);
    const ms10k = performance.now() - t0;
    expect(container.querySelectorAll(".vc-d-linha").length).toBeLessThan(200);
    unmount();
    const d2m = diffGrande(1);
    t0 = performance.now();
    const r2 = render(<DiffView diff={d2m} />);
    const ms2m = performance.now() - t0;
    // medição (jsdom, máquina de dev): 10k linhas e 1 MB: ver a linha [6E] impressa. Limites folgados: o orçamento real é medido no Electron.
    // eslint-disable-next-line no-console
    console.info(`[6E] DiffView 10k linhas: ${ms10k.toFixed(1)} ms; 1 MB: ${ms2m.toFixed(1)} ms`);
    expect(ms10k).toBeLessThan(400);
    expect(ms2m).toBeLessThan(800);
    expect(r2.container.querySelectorAll(".vc-d-linha").length).toBeLessThan(200);
    await act(async () => undefined);
  });
  it("diff grande por arquivo fica recolhido até 'Mostrar tudo'", () => {
    render(<DiffView diff={diffGrande(2)} />);
    expect(screen.getByRole("button", { name: "Mostrar tudo" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar tudo" }));
    expect(screen.queryByRole("button", { name: "Mostrar tudo" })).toBeNull();
  });
});
