import { describe, expect, it, vi } from "vitest";
import type { EventoCatalogo } from "../../compartilhado/catalogo";
import { catalogoFalso, item } from "../telas/catalogo/fabrica-teste";
import { criarStoreCatalogo, VALIDADE_CACHE_MS } from "./catalogo";

function montar(opcoes: Parameters<typeof catalogoFalso>[0] = {}) {
  const api = catalogoFalso(opcoes);
  let emitir: (e: EventoCatalogo) => void = () => undefined;
  api.assinar = (cb) => { emitir = cb; return () => undefined; };
  for (const k of Object.keys(api) as Array<keyof typeof api>) if (k !== "assinar") (api as unknown as Record<string, unknown>)[k] = vi.fn(api[k] as never);
  let t = 1_000_000;
  const store = criarStoreCatalogo({ api: () => api, workspace: () => "w1", agora: () => t, atrasoMs: 5 });
  return { api, store, emitir: (e: EventoCatalogo) => emitir(e), avancar: (ms: number) => { t += ms; } };
}
const esperar = (ms = 25) => new Promise((r) => setTimeout(r, ms));

describe("estado do catálogo", () => {
  it("carrega a aba inicial uma vez e trocar de aba com cache recente não faz IPC", async () => {
    const m = montar({ porTipo: { agent: [item("revisor", { tipo: "agent" })] } });
    await m.store.iniciar();
    expect(m.api.listar).toHaveBeenCalledTimes(1);
    await m.store.definirAba("agent");
    expect(m.api.listar).toHaveBeenCalledTimes(2);
    await m.store.definirAba("skill");
    await m.store.definirAba("agent");
    expect(m.api.listar).toHaveBeenCalledTimes(2); // cache recente: zero IPC
    m.avancar(VALIDADE_CACHE_MS + 1);
    await m.store.definirAba("skill");
    expect(m.api.listar).toHaveBeenCalledTimes(3); // cache velho recarrega
  });
  it("filtrar é local: digitar não chama a API", async () => {
    const m = montar();
    await m.store.iniciar();
    const antes = (m.api.listar as ReturnType<typeof vi.fn>).mock.calls.length;
    for (const q of ["f", "fr", "fro"]) m.store.definirFiltros({ busca: q });
    expect((m.api.listar as ReturnType<typeof vi.fn>).mock.calls.length).toBe(antes);
  });
  it("`mudou` com ids aplica diff (detalhe por id), sem recarregar a lista inteira", async () => {
    const m = montar();
    await m.store.iniciar();
    const novo = item("recem-chegada");
    (m.api.detalhe as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => (id === novo.id ? { ...novo, ferramentas: [] } : id === "cat_antiga" ? null : undefined));
    const listagens = (m.api.listar as ReturnType<typeof vi.fn>).mock.calls.length;
    m.emitir({ tipo_evento: "mudou", versao: 1, tipos: ["skill"], item_ids: [novo.id, "cat_antiga"] });
    await esperar();
    const nomes = m.store.obter().cache.skill?.itens.map((i) => i.nome) ?? [];
    expect(nomes).toContain("recem-chegada");
    expect(nomes).not.toContain("antiga");
    expect((m.api.listar as ReturnType<typeof vi.fn>).mock.calls.length).toBe(listagens);
  });
  it("`mudou` com lista vazia = recarregue a aba atual; `concluido` recarrega e limpa o progresso", async () => {
    const m = montar();
    await m.store.iniciar();
    m.emitir({ tipo_evento: "progresso", versao: 1, varredura_id: "v", cli: "claude", tipo: "skill", feitos: 3, total: 10 });
    expect(m.store.obter().varrendo).toBe(true);
    expect(m.store.obter().progresso).toEqual({ feitos: 3, total: 10 });
    m.emitir({ tipo_evento: "concluido", versao: 1, varredura_id: "v", adicionados: 1, atualizados: 0, ausentes: 0, duracao_ms: 5, erros: [{ cli: "codex", tipo: "skill", codigo: "permissao", mensagem: "sem permissão" }] });
    await esperar();
    expect(m.store.obter().varrendo).toBe(false);
    expect(m.store.obter().errosCli).toHaveLength(1);
    const n = (m.api.listar as ReturnType<typeof vi.fn>).mock.calls.length;
    m.emitir({ tipo_evento: "mudou", versao: 1, tipos: ["skill"], item_ids: [] });
    await esperar();
    expect((m.api.listar as ReturnType<typeof vi.fn>).mock.calls.length).toBe(n + 1);
  });
  it("sem a API (fora do Electron) marca indisponível", async () => {
    const store = criarStoreCatalogo({ api: () => undefined });
    await store.iniciar();
    expect(store.obter().disponivel).toBe(false);
  });
  it("erro de listagem vira mensagem e não derruba o estado", async () => {
    const m = montar();
    (m.api.listar as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("falhou feio"));
    await m.store.iniciar();
    expect(m.store.obter().erro).toBe("falhou feio");
  });
});
