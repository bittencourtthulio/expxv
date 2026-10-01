import { describe, expect, it, vi } from "vitest";
import type { Mission } from "../../compartilhado/dominio";
import { criarStoreMissoes } from "./missoes";

const m = (id: string, estado: Mission["estado"] = "executando"): Mission => ({ id, workspace_id: "w1", modo: "livre", origem: "livre", trabalho_id: null, titulo: id, estado, worktree: null, branch: null, piloto_pane_id: null, concluida_em: null, criado_em: "x", atualizado_em: "x" });

function montar() {
  let emitir: (e: { workspace_id: string; mission_id: string | null }) => void = () => undefined;
  const pendentes: Array<() => void> = [];
  const api = {
    listar: vi.fn().mockResolvedValue({ itens: [m("a"), m("b", "concluida")], proximo: null }),
    criar: vi.fn(), detalhe: vi.fn().mockResolvedValue(null), encerrar: vi.fn(), abortar: vi.fn(),
    portoes: vi.fn().mockResolvedValue({ mission_id: "a", liberados: [], pendentes: ["direction", "content", "build", "qa"] }),
    liberarPortao: vi.fn().mockResolvedValue({ mission_id: "a", liberados: ["build"], pendentes: ["direction", "content", "qa"] }),
    assinar: vi.fn((cb) => { emitir = cb; return () => undefined; }),
  };
  const store = criarStoreMissoes({ api: () => api, agendar: (fn) => { pendentes.push(fn); return () => undefined; } });
  return { api, store, emitir: (e: { workspace_id: string; mission_id: string | null }) => emitir(e), pendentes };
}

describe("store de missões", () => {
  it("assina uma vez, mesmo trocando de workspace, e conta as ativas", async () => {
    const { api, store } = montar();
    await store.definirWorkspace("w1");
    await store.definirWorkspace("w2");
    expect(api.assinar).toHaveBeenCalledTimes(1);
    expect(api.listar).toHaveBeenCalledTimes(2);
    expect(store.obter().ativas).toBe(1);
  });
  it("rajada de eventos vira uma única recarga", async () => {
    const { api, store, emitir, pendentes } = montar();
    await store.definirWorkspace("w1");
    api.listar.mockClear();
    for (let i = 0; i < 20; i++) emitir({ workspace_id: "w1", mission_id: "a" });
    expect(pendentes).toHaveLength(1);
    pendentes[0]!();
    await vi.waitFor(() => expect(api.listar).toHaveBeenCalledTimes(1));
  });
  it("evento de outro workspace é ignorado", async () => {
    const { store, emitir, pendentes } = montar();
    await store.definirWorkspace("w1");
    emitir({ workspace_id: "outro", mission_id: null });
    expect(pendentes).toHaveLength(0);
  });
  it("detalhe observado é recarregado junto da lista", async () => {
    const { api, store, emitir, pendentes } = montar();
    await store.definirWorkspace("w1");
    await store.observarDetalhe("a");
    api.detalhe.mockClear();
    emitir({ workspace_id: "w1", mission_id: "a" });
    pendentes[0]!();
    await vi.waitFor(() => expect(api.detalhe).toHaveBeenCalledWith("a"));
  });
  it("observar o detalhe carrega os portões; liberar publica o estado devolvido; falha nos portões não derruba o detalhe", async () => {
    const { api, store } = montar();
    await store.definirWorkspace("w1");
    await store.observarDetalhe("a");
    expect(store.obter().portoes["a"]?.pendentes).toHaveLength(4);
    await store.liberarPortao("a", "build");
    expect(api.liberarPortao).toHaveBeenCalledWith("a", "build");
    expect(store.obter().portoes["a"]?.liberados).toEqual(["build"]);
    api.portoes.mockRejectedValueOnce(new Error("x"));
    api.detalhe.mockResolvedValueOnce({ mission: m("a") });
    await store.observarDetalhe("a");
    expect(store.obter().detalhes["a"]).not.toBeNull();
    expect(store.obter().erro).toBeNull();
  });
});
