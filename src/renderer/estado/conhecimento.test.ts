import { describe, expect, it, vi } from "vitest";
import type { EventoConhecimentoApi } from "../../compartilhado/conhecimento-api";
import { conhecimentoFalso, ESTADO_CONHECIMENTO } from "../a11y/ade-falso-conhecimento";
import { criarStoreConhecimento } from "./conhecimento";
import { destinoDoAtalho } from "./conhecimento-acoes";

function montar(sobre: Parameters<typeof conhecimentoFalso>[0] = {}) {
  const api = conhecimentoFalso(sobre);
  let ouvinte: ((e: EventoConhecimentoApi) => void) | null = null;
  api.assinar = (cb) => { ouvinte = cb; return () => { ouvinte = null; }; };
  const fila: Array<() => void> = [];
  const avisar = vi.fn();
  const store = criarStoreConhecimento({ api: () => api, avisar, quadro: (f) => fila.push(f) });
  return { api, store, avisar, emitir: (e: EventoConhecimentoApi) => ouvinte?.(e), quadros: () => { while (fila.length > 0) fila.shift()?.(); }, ouvindo: () => ouvinte !== null };
}

describe("store do conhecimento", () => {
  it("assina eventos com o primeiro usuário e limpa com o último", () => {
    const { store, ouvindo } = montar();
    const a = store.iniciar();
    const b = store.iniciar();
    expect(ouvindo()).toBe(true);
    a();
    expect(ouvindo()).toBe(true);
    b();
    expect(ouvindo()).toBe(false);
  });

  it("carrega estado e config ao definir o workspace; trocar de workspace descarta o anterior", async () => {
    const { store } = montar();
    await store.definirWorkspace("w1");
    expect(store.obter().estado?.documentos).toBe(42);
    expect(store.obter().config?.chat_execucao).toBe("reversiveis");
    await store.definirWorkspace("w2");
    expect(store.obter().workspaceId).toBe("w2");
  });

  it("progresso é coalescido em UM quadro; fim da indexação recarrega estado e grafo", async () => {
    const subgrafo = vi.fn(async () => ({ nos: [], arestas: [], truncado: false }));
    const { store, emitir, quadros } = montar({ subgrafo });
    store.iniciar();
    await store.definirWorkspace("w1");
    emitir({ canal: "conhecimento:progresso", payload: { workspace_id: "w1", fase: "docs", pendentes: 9, pct: 10 } });
    emitir({ canal: "conhecimento:progresso", payload: { workspace_id: "w1", fase: "docs", pendentes: 3, pct: 70 } });
    expect(store.obter().progresso).toBeNull(); // nada antes do quadro
    quadros();
    expect(store.obter().progresso).toEqual({ fase: "docs", pendentes: 3, pct: 70 });
    emitir({ canal: "conhecimento:progresso", payload: { workspace_id: "w1", fase: null, pendentes: 0, pct: null } });
    quadros();
    expect(store.obter().progresso).toBeNull();
    await Promise.resolve();
    expect(subgrafo).toHaveBeenCalled();
  });

  it("evento de outro workspace é ignorado; aprendizado novo conta", async () => {
    const { store, emitir, quadros } = montar();
    store.iniciar();
    await store.definirWorkspace("w1");
    emitir({ canal: "conhecimento:progresso", payload: { workspace_id: "outro", fase: "docs", pendentes: 1, pct: 1 } });
    quadros();
    expect(store.obter().progresso).toBeNull();
    emitir({ canal: "conhecimento:aprendizado_novo", payload: { workspace_id: "w1", id: "a9", tipo: "decisao" } });
    expect(store.obter().aprendizadosNovos).toBe(1);
  });

  it("grafo: pede com o foco e os filtros; resposta velha não sobrescreve a nova", async () => {
    let soltar1: (v: { nos: never[]; arestas: never[]; truncado: boolean }) => void = () => undefined;
    const chamadas: Array<Record<string, unknown>> = [];
    const subgrafo = vi.fn((p: Record<string, unknown>) => {
      chamadas.push(p);
      if (chamadas.length === 1) return new Promise<{ nos: never[]; arestas: never[]; truncado: boolean }>((r) => { soltar1 = r; });
      return Promise.resolve({ nos: [], arestas: [], truncado: true });
    });
    const { store } = montar({ subgrafo: subgrafo as never });
    await store.definirWorkspace("w1");
    store.definirFiltrosGrafo({ tipos: ["task"], missionId: "m1" });
    const p1 = store.carregarGrafo(null);
    const p2 = store.carregarGrafo("n1");
    soltar1({ nos: [], arestas: [], truncado: false });
    await Promise.all([p1, p2]);
    expect(chamadas[1]).toMatchObject({ foco_no_id: "n1", tipos: ["task"], mission_id: "m1", max_nos: 1500 });
    expect(store.obter().truncado).toBe(true);
    expect(store.obter().focoNoId).toBe("n1");
  });

  it("busca só roda com texto, usa os parâmetros e guarda o feedback", async () => {
    const buscar = vi.fn(conhecimentoFalso().buscar);
    const { store } = montar({ buscar });
    await store.definirWorkspace("w1");
    await store.buscar();
    expect(buscar).not.toHaveBeenCalled();
    store.definirParametrosBusca({ consulta: "login", modo: "lexical", escopo: "missao" });
    await store.buscar();
    expect(buscar).toHaveBeenCalledWith(expect.objectContaining({ consulta: "login", modo: "lexical", escopo: "missao", workspace_id: "w1" }));
    expect(store.obter().busca.resposta?.estado).toBe("ok");
    expect(await store.darFeedback("chunk", "c1", "util")).toBe(true);
    expect(store.obter().busca.feedbacks["chunk:c1"]).toBe("util");
  });

  it("canal ausente vira 'indisponível', não erro", async () => {
    const { store } = montar({ estado: async () => { throw new Error("No handler registered for 'conhecimento:estado'"); } });
    await store.definirWorkspace("w1");
    expect(store.obter().disponivel).toBe(false);
    expect(store.obter().erroEstado).toBeNull();
  });

  it("aprendizados: filtros, paginação por cursor sem duplicar, atualização local", async () => {
    const listar = vi.fn()
      .mockResolvedValueOnce({ itens: [{ ...conhecimentoFaltaA("a1") }], proximo: "c1" })
      .mockResolvedValueOnce({ itens: [conhecimentoFaltaA("a1"), conhecimentoFaltaA("a2")], proximo: null });
    const { store } = montar({ listarAprendizados: listar });
    await store.definirWorkspace("w1");
    store.definirFiltrosAprendizados({ estado: "candidato" });
    await store.carregarAprendizados();
    expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ estado: "candidato", depois: null }));
    await store.carregarAprendizados(true);
    expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ depois: "c1" }));
    expect(store.obter().aprendizados.itens.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(await store.atualizarAprendizado("a1", "ativar")).toBe(true);
    expect(store.obter().aprendizados.itens[0]?.estado).toBe("ativo");
  });

  it("estado de fábrica é coerente", () => {
    expect(ESTADO_CONHECIMENTO.ativo).toBe(true);
  });
});

function conhecimentoFaltaA(id: string) {
  return { id, tipo: "decisao" as const, titulo: id, texto: "t", fonte: "sistema" as const, estado: "candidato" as const, confianca: 0.5, vezes_visto: 1, util: 0, inutil: 0, errado: 0, criado_em: "2026-10-01T00:00:00Z" };
}

describe("atalhos Chat e Conhecimento", () => {
  const k = (key: string, extra: object = {}) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...extra });
  it("⌘⇧K abre o chat e ⌘⇧G o conhecimento no mac; Ctrl+Shift nos outros; sem Shift não faz nada", () => {
    expect(destinoDoAtalho(k("k", { metaKey: true, shiftKey: true }), true)).toBe("chat");
    expect(destinoDoAtalho(k("G", { metaKey: true, shiftKey: true }), true)).toBe("conhecimento");
    expect(destinoDoAtalho(k("k", { ctrlKey: true, shiftKey: true }), false)).toBe("chat");
    expect(destinoDoAtalho(k("g", { ctrlKey: true, shiftKey: true }), false)).toBe("conhecimento");
    expect(destinoDoAtalho(k("k", { metaKey: true }), true)).toBeNull();
    expect(destinoDoAtalho(k("k", { ctrlKey: true, shiftKey: true }), true)).toBeNull();
    expect(destinoDoAtalho(k("k", { metaKey: true, shiftKey: true, altKey: true }), true)).toBeNull();
  });
});
