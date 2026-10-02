// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarStorePainelWorkspaces, storePainelWorkspaces } from "../estado/painel-workspaces";
import { BotaoFixarPainel } from "./BotaoFixarPainel";
import { Navegacao } from "./Navegacao";
import { Topo } from "./Topo";

afterEach(() => { cleanup(); storePainelWorkspaces.definirFixado(false); delete (globalThis as { ade?: unknown }).ade; });
beforeEach(() => { try { localStorage.clear(); } catch { /* sem storage */ } storePainelWorkspaces.definirFixado(false); });

describe("alfinete do cabeçalho", () => {
  it("é um botão com aria-pressed que alterna o estado fixado", () => {
    const store = criarStorePainelWorkspaces({ api: () => undefined, armazem: null });
    render(<BotaoFixarPainel store={store} />);
    const b = screen.getByRole("button", { name: "Fixar painel de workspaces" });
    expect(b.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(b);
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(store.obter().prefs.fixado).toBe(true);
    fireEvent.click(b);
    expect(b.getAttribute("aria-pressed")).toBe("false");
  });

  it("tem um atalho fixo para os Terminais logo depois do seletor de workspace", () => {
    render(<Topo tema="escuro" aoAlternarTema={() => undefined} />);
    const b = screen.getByRole("button", { name: "Ir para os Terminais" });
    expect(b.previousElementSibling?.matches(".seletor-ws")).toBe(true);
  });

  it("fica no começo do grupo esquerdo do cabeçalho, ANTES do seletor de workspace (e da informação do git)", () => {
    render(<Topo tema="escuro" aoAlternarTema={() => undefined} />);
    const esquerda = document.querySelector(".topo-esquerda")!;
    const filhos = [...esquerda.children].map((e) => (e.matches(".seletor-ws") ? "seletor" : e.matches(".topo-fixar-painel") ? "fixar" : e.className));
    expect(filhos.slice(0, 2)).toEqual(["fixar", "seletor"]);
  });
});

describe("casca com o painel", () => {
  it("desafixado: nada de painel, nada de chamada ao main; fixado: reserva a coluna e carrega o painel sob demanda", async () => {
    const api = {
      resumo: vi.fn(async () => ({ versao: 1 as const, gerado_em: 1, itens: [] })),
      ativarResumo: vi.fn(async (a: boolean) => a), assinarResumo: vi.fn(() => () => undefined),
      encerrarAgente: vi.fn(), revelar: vi.fn(), copiarCaminho: vi.fn(),
      estado: vi.fn(async () => ({ atual: null, recentes: [] })), assinar: vi.fn(() => () => undefined), abrir: vi.fn(), definirAtual: vi.fn(), remover: vi.fn(), definirPermissao: vi.fn(), worktrees: vi.fn(),
    };
    (globalThis as { ade?: unknown }).ade = { versao: async () => "0.0.0", workspaces: api };
    render(<Navegacao />);
    expect(document.querySelector(".casca")!.hasAttribute("data-painel-ws")).toBe(false);
    expect(screen.queryByRole("complementary", { name: "Workspaces" })).toBeNull();
    expect(api.resumo).not.toHaveBeenCalled();
    expect(api.ativarResumo).not.toHaveBeenCalled();
    await act(async () => { storePainelWorkspaces.alternarFixado(); });
    expect(document.querySelector(".casca")!.hasAttribute("data-painel-ws")).toBe(true);
    expect(await screen.findByRole("heading", { name: "Workspaces" })).toBeTruthy();
    expect(api.ativarResumo).toHaveBeenCalledWith(true);
    await act(async () => { storePainelWorkspaces.alternarFixado(); });
    expect(screen.queryByRole("complementary", { name: "Workspaces" })).toBeNull();
    expect(api.ativarResumo).toHaveBeenLastCalledWith(false);
  });
});
