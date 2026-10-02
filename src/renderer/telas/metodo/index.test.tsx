// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { IndiceProjeto } from "../../../nucleo/metodo/tipos";
import { criarStoreMetodo } from "../../estado/metodo";
import { aoPedirTela } from "../../estado/navegacao";
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
    expect(await screen.findByText(/ainda não tem docs do método/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Nova feature/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /O que você quer construir ou corrigir/ })).toBeTruthy();
  });

  it("com docs/ e sem trabalhos", async () => {
    montar("w1", indice([]));
    expect(await screen.findByRole("textbox", { name: /O que você quer construir ou corrigir/ })).toBeTruthy();
  });

  it("com trabalhos: a aba padrão é o Pedido, sem lista de trabalhos, só o atalho discreto", async () => {
    montar("w1", indice([trabalho([tk("T-1")]), trabalho([tk("T-2")], { id: "outro", titulo: "Outra" })]));
    expect(await screen.findByRole("textbox", { name: /O que você quer construir ou corrigir/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Pedido" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("tab", { name: "Trabalhos" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Minha feature/ })).toBeNull();
    const atalho = screen.getByRole("button", { name: "Ver trabalhos (2)" });
    const ouvir = vi.fn();
    const sai = aoPedirTela(ouvir);
    fireEvent.click(atalho);
    expect(ouvir).toHaveBeenCalledWith("trabalhos");
    sai();
  });

  it("as demais abas seguem na sub-navegação lateral esquerda", async () => {
    montar("w1", indice([trabalho()]));
    await screen.findByRole("tab", { name: "Pedido" });
    for (const n of ["Violações", "Instalação", "Saúde"]) expect(screen.getByRole("tab", { name: new RegExp(n) })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Saúde" })); });
    expect(screen.queryByRole("textbox", { name: /O que você quer construir ou corrigir/ })).toBeNull();
  });
});
