// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "../../../compartilhado/dominio";
import { storeAdicionarWorkspace } from "../../estado/adicionar-workspace";
import { criarStoreWorkspaces } from "../../estado/workspaces";
import { TelaWorkspaces } from "./index";

const ws = (id: string, extra: Partial<Workspace> = {}): Workspace => ({ id, nome: id, raiz: `/p/${id}`, e_git: true, acesso_externo: "leitura", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x", ...extra });

async function montar(recentes: Workspace[], atual: Workspace | null = recentes[0] ?? null) {
  const api = {
    estado: vi.fn().mockResolvedValue({ atual, recentes }), assinar: vi.fn(() => () => undefined), abrir: vi.fn().mockResolvedValue(null),
    definirAtual: vi.fn().mockResolvedValue(null), remover: vi.fn().mockResolvedValue(true), definirPermissao: vi.fn().mockResolvedValue(null),
    worktrees: vi.fn().mockResolvedValue([{ caminho: ".", branch: "main", principal: true, sujo: false }]),
  };
  const store = criarStoreWorkspaces({ api: () => api });
  await act(async () => { await store.iniciar(); });
  render(<TelaWorkspaces store={store} />);
  return api;
}

describe("Tela de workspaces", () => {
  it("estado vazio guia o primeiro uso e abre o modal Adicionar workspace", async () => {
    const api = await montar([]);
    expect(screen.getByText("Nenhum workspace aberto")).toBeTruthy();
    expect(screen.getByText(/clone um repositório ou crie um projeto novo/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Adicionar workspace/ })[1]!);
    expect(storeAdicionarWorkspace.obter()).toMatchObject({ aberto: true, secao: "pasta" });
    expect(api.abrir).not.toHaveBeenCalled();
    storeAdicionarWorkspace.fechar();
  });
  it("remover pede confirmação pela UI, diz que não apaga do disco e só então remove", async () => {
    const api = await montar([ws("alfa")]);
    fireEvent.click(screen.getByRole("button", { name: "Remover da lista" }));
    const d = screen.getByRole("dialog");
    expect(within(d).getByText(/Nada é apagado do disco/)).toBeTruthy();
    expect(api.remover).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(d).getByRole("button", { name: "Remover da lista" })); });
    expect(api.remover).toHaveBeenCalledWith("alfa");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("cancelar a remoção não remove", async () => {
    const api = await montar([ws("alfa")]);
    fireEvent.click(screen.getByRole("button", { name: "Remover da lista" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(api.remover).not.toHaveBeenCalled();
  });
  it("ativar automático exige confirmação com o aviso; workspace automático exibe o aviso fixo", async () => {
    const api = await montar([ws("alfa")]);
    fireEvent.click(screen.getByLabelText("Automático"));
    const d = screen.getByRole("dialog");
    expect(within(d).getByText(/sem pedir confirmação a cada ação/)).toBeTruthy();
    await act(async () => { fireEvent.click(within(d).getByRole("button", { name: "Ativar automático" })); });
    expect(api.definirPermissao).toHaveBeenCalledWith("alfa", "automatico");
  });
  it("permissão automático já gravada mostra o aviso; seguro não troca sem clique", async () => {
    await montar([ws("beta", { permissao: "automatico" })]);
    expect(screen.getByRole("note").textContent).toMatch(/sem pedir confirmação/);
  });
  it("mostra git, acesso externo (somente exibe) e worktrees sob demanda", async () => {
    const api = await montar([ws("alfa")]);
    expect(screen.getByText("Acesso externo: leitura")).toBeTruthy();
    expect(api.worktrees).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Worktrees" })); });
    expect(screen.getByRole("list", { name: "Worktrees" }).textContent).toContain("main");
  });
});
