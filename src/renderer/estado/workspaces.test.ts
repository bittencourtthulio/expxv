import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "../../compartilhado/dominio";
import { criarStoreWorkspaces } from "./workspaces";

const ws = (id: string): Workspace => ({ id, nome: id, raiz: `/p/${id}`, e_git: false, acesso_externo: "nenhum", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x" });
const fazerApi = () => {
  let cb: (e: { atual: Workspace | null; recentes: Workspace[] }) => void = () => undefined;
  return {
    emitir: (e: { atual: Workspace | null; recentes: Workspace[] }) => cb(e),
    api: { estado: vi.fn().mockResolvedValue({ atual: ws("a"), recentes: [ws("a")] }), assinar: vi.fn((c) => { cb = c; return () => undefined; }), abrir: vi.fn(), definirAtual: vi.fn(), remover: vi.fn().mockResolvedValue(true), definirPermissao: vi.fn(), worktrees: vi.fn().mockResolvedValue([]) },
  };
};

describe("store de workspaces", () => {
  it("assina uma única vez mesmo com iniciar() repetido e carrega o estado inicial", async () => {
    const { api } = fazerApi();
    const s = criarStoreWorkspaces({ api: () => api });
    await Promise.all([s.iniciar(), s.iniciar()]);
    await s.iniciar();
    expect(api.assinar).toHaveBeenCalledTimes(1);
    expect(api.estado).toHaveBeenCalledTimes(1);
    expect(s.obter()).toMatchObject({ carregado: true, atual: { id: "a" } });
  });
  it("o evento atualiza o estado e notifica ouvintes", async () => {
    const { api, emitir } = fazerApi();
    const s = criarStoreWorkspaces({ api: () => api });
    await s.iniciar();
    const o = vi.fn();
    s.assinar(o);
    emitir({ atual: ws("b"), recentes: [ws("b"), ws("a")] });
    expect(s.obter().atual?.id).toBe("b");
    expect(o).toHaveBeenCalledTimes(1);
  });
  it("sem API marca indisponível sem quebrar; falha vira mensagem", async () => {
    const s = criarStoreWorkspaces({ api: () => undefined });
    await s.iniciar();
    expect(s.obter()).toMatchObject({ carregado: true, disponivel: false });
    const { api } = fazerApi();
    api.abrir.mockRejectedValue(new Error("pasta inexistente"));
    const s2 = criarStoreWorkspaces({ api: () => api });
    await s2.abrir(null);
    expect(s2.obter().erro).toContain("pasta inexistente");
  });
});
