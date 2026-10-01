// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { IndiceProjeto } from "../../../nucleo/metodo/tipos";
import { criarStoreMetodo } from "../../estado/metodo";
import Tela from "./index";
import { indice, tk, trabalho } from "./fabrica";

function montar(atual: string | null, resp: IndiceProjeto | null) {
  const api = {
    metodo: { estado: vi.fn(async () => resp), assinar: () => () => {}, rastro: vi.fn(async () => ({ eventos: [], proximo: 0 })) },
    workspaces: { estado: async () => ({ atual: atual ? { id: atual } : null, recentes: [] }), assinar: () => () => {} },
  } as unknown as ApiAde;
  (globalThis as unknown as { ade: unknown }).ade = api;
  const store = criarStoreMetodo({ api: () => api });
  return render(<Tela store={store} />);
}
afterEach(() => { delete (globalThis as { ade?: unknown }).ade; });

describe("Tela Método", () => {
  it("sem workspace: estado vazio claro", async () => {
    montar(null, null);
    expect(await screen.findByText("Nenhum projeto aberto")).toBeTruthy();
  });

  it("sem docs/: estado normal, com caminho para criar o primeiro trabalho", async () => {
    montar("w1", null);
    expect(await screen.findByText(/não tem docs do método/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nova feature" })).toBeTruthy();
  });

  it("com docs/ e sem trabalhos", async () => {
    montar("w1", indice([]));
    expect(await screen.findByText("Sem trabalhos ainda")).toBeTruthy();
  });

  it("lista trabalhos com sinaleira em texto e abre o detalhe", async () => {
    const t = trabalho([tk("T-1", { status: "concluida" }), tk("T-2", { depende_de: ["T-1"] })], {
      sinaleira: { cor: "amarelo", motivo: "Auditoria pendente", motivos: [] }, veredito_auditoria: "aprovado",
      entrega: { estado: "aberta", branch: "feat/x", portao: "PRONTO", pr_url: null, pr_estado: null, commits: 3, arquivo: "docs/mergex/E.md" },
    });
    montar("w1", indice([t]));
    expect(await screen.findByLabelText(/Sinaleira atenção: Auditoria pendente/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Minha feature/ })); });
    expect(screen.getByRole("heading", { name: "Minha feature" })).toBeTruthy();
    expect(screen.getByText("feat/x")).toBeTruthy();
    expect(screen.getByText(/Auditoria:/).textContent).toContain("Aprovado");
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Quadro" })); });
    expect(screen.getByRole("region", { name: "Coluna Pendente" })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Grafo" })); });
    expect(await screen.findByRole("img", { name: /Grafo do plano/ })).toBeTruthy();
  });
});
