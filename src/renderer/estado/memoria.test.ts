import { describe, expect, it, vi } from "vitest";
import type { ApiMemoria, EventoMemoria } from "../../compartilhado/memoria";
import { ENTRADAS_MEMORIA, ESTADO_MEMORIA, entrada, memoriaFalso } from "../a11y/ade-falso-memoria";
import { PAGINA, criarStoreMemoria } from "./memoria";

const criar = (sobre: Partial<ApiMemoria> = {}) => {
  const api = memoriaFalso(sobre);
  const filaQuadro: Array<() => void> = [];
  const avisar = vi.fn();
  const store = criarStoreMemoria({ api: () => api, avisar, quadro: (fn) => void filaQuadro.push(fn) });
  const rodarQuadro = (): void => { filaQuadro.splice(0).forEach((f) => f()); };
  return { api, store, avisar, rodarQuadro };
};
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("estado da memória (T-08.21)", () => {
  it("definirWorkspace carrega só o estado; a lista vem de garantirLista (uma vez)", async () => {
    const listar = vi.fn(async () => ({ itens: ENTRADAS_MEMORIA, proximo: null }));
    const { store } = criar({ listar });
    await store.definirWorkspace("w1");
    expect(store.obter().estado).toEqual(ESTADO_MEMORIA);
    expect(listar).not.toHaveBeenCalled();
    await store.garantirLista();
    await store.garantirLista();
    expect(listar).toHaveBeenCalledTimes(1);
    expect(listar).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "w1", escopo: "pane", limite: PAGINA, tipos: null, busca: null, depois: null }));
    expect(store.obter().itens).toHaveLength(ENTRADAS_MEMORIA.length);
  });

  it("filtros viram pedido (tipos, missão, painel); a busca espera 250 ms; origem é do cliente (não recarrega)", async () => {
    vi.useFakeTimers();
    try {
      const listar = vi.fn(async () => ({ itens: [], proximo: null }));
      const { store } = criar({ listar });
      await store.definirWorkspace("w1");
      store.definirFiltros({ aba: "missao", tipos: ["risco"], missionId: "m1" });
      await vi.advanceTimersByTimeAsync(0);
      expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ escopo: "missao", tipos: ["risco"], mission_id: "m1", pane_id: null }));
      const n = listar.mock.calls.length;
      store.definirFiltros({ busca: "login" });
      store.definirFiltros({ busca: "login t" });
      expect(listar).toHaveBeenCalledTimes(n);
      await vi.advanceTimersByTimeAsync(260);
      expect(listar).toHaveBeenCalledTimes(n + 1);
      expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ busca: "login t" }));
      store.definirFiltros({ origem: "agente" });
      await vi.advanceTimersByTimeAsync(300);
      expect(listar).toHaveBeenCalledTimes(n + 1);
      store.definirFiltros({ missionId: "m2" }); // trocar de Missão zera o painel
      expect(store.obter().filtros.paneId).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("evento entrada_criada NÃO recarrega a lista: coalesce em 1 quadro, busca só o topo e mescla", async () => {
    const nova = entrada("mem_nova", { conteudo: "acabou de chegar" });
    const listar = vi.fn(async (p: { limite: number }) => (p.limite === PAGINA ? { itens: ENTRADAS_MEMORIA.filter((e) => e.escopo === "pane"), proximo: null } : { itens: [nova, ...ENTRADAS_MEMORIA.filter((e) => e.escopo === "pane").slice(0, 2)], proximo: null }));
    let emitir: (e: EventoMemoria) => void = () => undefined;
    const { store, rodarQuadro } = criar({ listar: listar as never, assinar: (cb) => { emitir = cb; return () => undefined; } });
    store.iniciar();
    await store.definirWorkspace("w1");
    await store.garantirLista();
    const antes = store.obter().itens.length;
    for (let i = 0; i < 30; i++) emitir({ canal: "memoria:entrada_criada", payload: { entrada_id: `e${i}`, escopo: "pane", tipo: "evento" } });
    emitir({ canal: "memoria:aviso", payload: { pane_id: null, codigo: "fts5_indisponivel", mensagem: "x" } }); // outros eventos não contam
    expect(listar).toHaveBeenCalledTimes(1); // nada ainda: espera o quadro
    rodarQuadro();
    await tick();
    expect(listar).toHaveBeenCalledTimes(2);
    expect(listar.mock.calls[1]![0].limite).toBe(35); // min(50, 30 + 5): só o topo
    expect(store.obter().itens[0]?.id).toBe("mem_nova");
    expect(store.obter().itens).toHaveLength(antes + 1);
  });

  it("com busca ativa o evento só conta 'novas' (sem recarregar); recarregar zera", async () => {
    const listar = vi.fn(async () => ({ itens: [], proximo: null }));
    let emitir: (e: EventoMemoria) => void = () => undefined;
    const { store, rodarQuadro } = criar({ listar, assinar: (cb) => { emitir = cb; return () => undefined; } });
    store.iniciar();
    await store.definirWorkspace("w1");
    store.definirFiltros({ tipos: ["risco"] });
    await tick();
    const n = listar.mock.calls.length;
    emitir({ canal: "memoria:entrada_criada", payload: { entrada_id: "e1", escopo: "pane", tipo: "risco" } });
    emitir({ canal: "memoria:entrada_criada", payload: { entrada_id: "e2", escopo: "pane", tipo: "risco" } });
    rodarQuadro();
    await tick();
    expect(listar).toHaveBeenCalledTimes(n);
    expect(store.obter().novas).toBe(2);
    await store.recarregar();
    expect(store.obter().novas).toBe(0);
  });

  it("paginação: carregarMais usa o cursor e não duplica", async () => {
    const p1 = Array.from({ length: 3 }, (_, i) => entrada(`a${i}`));
    const listar = vi.fn(async (p: { depois: string | null }) => (p.depois === null ? { itens: p1, proximo: "cur1" } : { itens: [p1[2]!, entrada("b0")], proximo: null }));
    const { store } = criar({ listar: listar as never });
    await store.definirWorkspace("w1");
    await store.garantirLista();
    await store.carregarMais();
    expect(store.obter().itens.map((e) => e.id)).toEqual(["a0", "a1", "a2", "b0"]);
    expect(store.obter().proximo).toBeNull();
    await store.carregarMais(); // sem cursor: nada
    expect(listar).toHaveBeenCalledTimes(2);
  });

  it("resposta velha de outro workspace é descartada (geração)", async () => {
    let soltar: (v: { itens: never[]; proximo: null }) => void = () => undefined;
    const listar = vi.fn(() => new Promise<{ itens: never[]; proximo: null }>((r) => { soltar = r; }));
    const { store } = criar({ listar: listar as never });
    await store.definirWorkspace("w1");
    const p = store.garantirLista();
    await store.definirWorkspace("w2");
    soltar({ itens: [entrada("velha")] as never, proximo: null });
    await p;
    expect(store.obter().itens).toEqual([]);
  });

  it("esquecer remove da lista sem recarregar; falha do canal vira aviso e mantém a lista", async () => {
    const listar = vi.fn(async () => ({ itens: [entrada("a"), entrada("b")], proximo: null }));
    const esquecer = vi.fn().mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error("boom"));
    const { store, avisar } = criar({ listar, esquecer });
    await store.definirWorkspace("w1");
    await store.garantirLista();
    expect(await store.esquecer("a")).toBe(true);
    expect(store.obter().itens.map((e) => e.id)).toEqual(["b"]);
    expect(listar).toHaveBeenCalledTimes(1);
    expect(await store.esquecer("b")).toBe(false);
    expect(store.obter().itens.map((e) => e.id)).toEqual(["b"]);
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining("boom"), "erro");
  });

  it("atualizar (editar/fixar) troca a entrada no lugar e preserva o display_id", async () => {
    const listar = vi.fn(async () => ({ itens: [entrada("a", { display_id: 7 }), entrada("b")], proximo: null }));
    const atualizar = vi.fn(async (p: { entrada_id: string; importancia?: number }) => ({ ...entrada(p.entrada_id, { display_id: null }), importancia: (p.importancia ?? 3) as 5 }));
    const { store } = criar({ listar, atualizar });
    await store.definirWorkspace("w1");
    await store.garantirLista();
    await store.atualizar("a", { importancia: 5 });
    expect(atualizar).toHaveBeenCalledWith({ entrada_id: "a", importancia: 5 });
    expect(store.obter().itens[0]).toMatchObject({ id: "a", importancia: 5, display_id: 7 });
  });

  it("config e chave por Missão refletem no estado local", async () => {
    const { store } = criar();
    await store.definirWorkspace("w1");
    await store.gravarConfig({ retencao_dias: 0 });
    expect(store.obter().estado?.config.retencao_dias).toBeDefined();
    await store.definirMissao("m1", false);
    expect(store.obter().estado?.missoes).toEqual({ m1: false });
    await store.definirMissao("m1", null);
    expect(store.obter().estado?.missoes).toEqual({});
  });

  it("preferências: listar, gravar (novo e edição), remover", async () => {
    const { store } = criar();
    await store.carregarPreferencias();
    expect(store.obter().prefCarregado).toBe(true);
    expect(store.obter().preferencias).toHaveLength(1);
    const nova = await store.gravarPreferencia(null, "regra nova", 4);
    expect(nova?.conteudo).toBe("regra nova");
    expect(store.obter().preferencias[0]?.id).toBe(nova?.id);
    await store.gravarPreferencia(nova!.id, "regra editada", 4);
    expect(store.obter().preferencias.find((p) => p.id === nova!.id)?.conteudo).toBe("regra editada");
    expect(store.obter().preferencias).toHaveLength(2);
    await store.removerPreferencia(nova!.id);
    expect(store.obter().preferencias).toHaveLength(1);
  });

  it("purgar e exportar passam pelo canal; exportar cancelado devolve null sem aviso de sucesso", async () => {
    const purgar = vi.fn(async () => ({ removidas: 4 }));
    const exportar = vi.fn().mockResolvedValueOnce({ caminho_salvo: null }).mockResolvedValueOnce({ caminho_salvo: "/x/m.json" });
    const { store, avisar } = criar({ purgar, exportar });
    await store.definirWorkspace("w1");
    expect(await store.purgar("tudo", "w1")).toBe(4);
    expect(purgar).toHaveBeenCalledWith({ workspace_id: "w1", escopo: "tudo", confirmacao: "w1" });
    expect(await store.exportar("tudo")).toBeNull();
    expect(avisar).not.toHaveBeenCalled();
    expect(await store.exportar("workspace")).toBe("/x/m.json");
    expect(avisar).toHaveBeenCalledWith("Memória exportada.", "sucesso");
  });

  it("prévia do brief é cacheada até pedir de novo", async () => {
    const briefPrevia = vi.fn(async () => ({ markdown: "m", caracteres: 1, truncado: false, modo: "missao" as const }));
    const { store } = criar({ briefPrevia });
    await store.previa("p1");
    await store.previa("p1");
    expect(briefPrevia).toHaveBeenCalledTimes(1);
    await store.previa("p1", true);
    expect(briefPrevia).toHaveBeenCalledTimes(2);
    store.esquecerPrevia("p1");
    expect(store.obter().previas["p1"]).toBeUndefined();
  });

  it("sem canal (fora do Electron) = indisponível, nunca erro; canal não registrado também", async () => {
    const sem = criarStoreMemoria({ api: () => undefined });
    sem.iniciar();
    await sem.definirWorkspace("w1");
    await sem.garantirLista();
    expect(sem.obter().disponivel).toBe(false);
    const { store } = criar({ listar: async () => { throw new Error("No handler registered for 'memoria:listar'"); } });
    await store.definirWorkspace("w1");
    await store.garantirLista();
    expect(store.obter().disponivel).toBe(false);
    expect(store.obter().erro).toBeNull();
  });

  it("erro real de listagem fica no estado (com mensagem) e permite recarregar", async () => {
    const listar = vi.fn().mockRejectedValueOnce(new Error("disco cheio")).mockResolvedValue({ itens: [entrada("a")], proximo: null });
    const { store } = criar({ listar });
    await store.definirWorkspace("w1");
    await store.garantirLista();
    expect(store.obter().erro).toContain("disco cheio");
    await store.recarregar();
    expect(store.obter().erro).toBeNull();
    expect(store.obter().itens).toHaveLength(1);
  });
});
