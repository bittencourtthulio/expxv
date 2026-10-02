// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "../../compartilhado/dominio";
import { storeAdicionarWorkspace } from "../estado/adicionar-workspace";
import { criarStoreWorkspaces } from "../estado/workspaces";
import { SeletorWorkspace } from "./SeletorWorkspace";

const ws = (id: string, nome: string): Workspace => ({ id, nome, raiz: `/p/${nome}`, e_git: true, acesso_externo: "nenhum", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x" });

async function montar(atual: Workspace | null, recentes: Workspace[]) {
  const api = { estado: vi.fn().mockResolvedValue({ atual, recentes }), assinar: vi.fn(() => () => undefined), abrir: vi.fn().mockResolvedValue(null), definirAtual: vi.fn().mockResolvedValue(null), remover: vi.fn(), definirPermissao: vi.fn(), worktrees: vi.fn() };
  const store = criarStoreWorkspaces({ api: () => api });
  await act(async () => { await store.iniciar(); });
  render(<SeletorWorkspace store={store} />);
  return api;
}

describe("SeletorWorkspace", () => {
  it("sem workspace mostra 'Nenhum workspace' e 'Adicionar workspace…' abre o modal (D-600), não o diálogo nativo direto", async () => {
    const api = await montar(null, []);
    fireEvent.click(screen.getByRole("button", { name: /Nenhum workspace/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Adicionar workspace/ }));
    expect(storeAdicionarWorkspace.obter()).toMatchObject({ aberto: true, secao: "pasta" });
    expect(api.abrir).not.toHaveBeenCalled();
    storeAdicionarWorkspace.fechar();
  });
  it("lista recentes, marca o atual e troca pelo clique", async () => {
    const a = ws("a", "alfa"), b = ws("b", "beta");
    const api = await montar(a, [a, b]);
    fireEvent.click(screen.getByRole("button", { name: /alfa/ }));
    expect(screen.getByRole("menuitemradio", { name: /alfa/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /beta/ }));
    expect(api.definirAtual).toHaveBeenCalledWith("b");
  });
});
