// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Mission, Workspace } from "../../../compartilhado/dominio";
import { pedirAcao } from "../../estado/navegacao";
import { criarStoreMissoes } from "../../estado/missoes";
import { criarStoreWorkspaces } from "../../estado/workspaces";
import { TelaMissoes } from "./index";
import { ListaMissoes } from "./Lista";

const mis = (i: number): Mission => ({ id: `m${i}`, workspace_id: "w1", modo: "livre", origem: "livre", trabalho_id: null, titulo: `Missão ${i}`, estado: "executando", worktree: null, branch: null, piloto_pane_id: null, concluida_em: null, criado_em: "x", atualizado_em: "x" });
const w: Workspace = { id: "w1", nome: "p", raiz: "/p", e_git: true, acesso_externo: "nenhum", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x" };

async function montar(itens: Mission[], atual: Workspace | null = w) {
  const apiW = { estado: vi.fn().mockResolvedValue({ atual, recentes: atual ? [atual] : [] }), assinar: vi.fn(() => () => undefined), abrir: vi.fn(), definirAtual: vi.fn(), remover: vi.fn(), definirPermissao: vi.fn(), worktrees: vi.fn() };
  const apiM = { listar: vi.fn().mockResolvedValue({ itens, proximo: null }), criar: vi.fn(), detalhe: vi.fn().mockResolvedValue(null), encerrar: vi.fn(), abortar: vi.fn(), portoes: vi.fn().mockResolvedValue(null), liberarPortao: vi.fn().mockResolvedValue(null), assinar: vi.fn(() => () => undefined) };
  const ws = criarStoreWorkspaces({ api: () => apiW });
  const store = criarStoreMissoes({ api: () => apiM });
  await ws.iniciar();
  await act(async () => { render(<TelaMissoes store={store} workspaces={ws} />); });
  return { apiM };
}

describe("Tela de missões", () => {
  it("sem workspace guia para abrir uma pasta", async () => {
    await montar([], null);
    expect(screen.getByText("Abra um workspace primeiro")).toBeTruthy();
  });
  it("sem missões mostra estado vazio explicativo com ação", async () => {
    await montar([]);
    expect(screen.getByText("Nenhuma missão ainda")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Nova missão" }).length).toBeGreaterThan(0);
  });
  it("quadro agrupa por estado e 'Nova missão' abre o wizard", async () => {
    await montar([mis(1), { ...mis(2), estado: "concluida" }]);
    expect(screen.getByRole("region", { name: "Executando" }).textContent).toContain("Missão 1");
    expect(screen.getByRole("region", { name: "Concluída" }).textContent).toContain("Missão 2");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Nova missão" })); });
    expect(screen.getByRole("dialog", { name: "Nova missão" })).toBeTruthy();
  });
  it("pedirAcao('nova-missao') (paleta) abre o wizard sem clicar em botão", async () => {
    await montar([mis(1)]);
    expect(screen.queryByRole("dialog", { name: "Nova missão" })).toBeNull();
    await act(async () => { pedirAcao("nova-missao"); });
    expect(screen.getByRole("dialog", { name: "Nova missão" })).toBeTruthy();
  });
  it("lista com 1 000 missões mantém poucos nós no DOM", async () => {
    render(<ListaMissoes itens={Array.from({ length: 1000 }, (_, i) => mis(i))} aoAbrir={() => undefined} />);
    expect(document.querySelectorAll('[role="listitem"]').length).toBeLessThanOrEqual(20);
  });
});
