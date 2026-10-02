import { describe, expect, it, vi } from "vitest";
import { buscarFuzzy } from "../busca-fuzzy";
import { aoPedirChat, aoPedirConhecimento, pedirChat, pedirConhecimento, VALIDADE_PEDIDO_CONHECIMENTO_MS, type PedidoChat, type PedidoConhecimento } from "./conhecimento-acoes";
import { aoPedirTela } from "./navegacao";
import { montarComandos, textoDeBusca, type ContextoPaleta } from "./paleta";

const acoes = { navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn() };
const sem: ContextoPaleta = { mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "escuro", acoes };
const com: ContextoPaleta = { ...sem, workspaceAtual: { id: "w1", nome: "Loja" } };
const grupo = (c: ContextoPaleta) => montarComandos(c).filter((x) => x.grupo === "Conhecimento");

describe("paleta: comandos do Conhecimento e do Chat (Fase 15)", () => {
  it("abrir chat e abrir grafo sempre; perguntar, orquestrar, reindexar e sincronizar só com projeto", () => {
    expect(grupo(sem).map((c) => c.id)).toEqual(["conhecimento:chat", "conhecimento:grafo"]);
    expect(grupo(com).map((c) => c.titulo)).toEqual(["Abrir chat", "Abrir grafo", "Perguntar ao RAG…", "Pedir ao orquestrador…", "Reindexar", "Sincronizar RAG"]);
  });
  it("mostra os atalhos por plataforma (⌘⇧K/⌘⇧G e Ctrl+Shift+K/G)", () => {
    expect(montarComandos(com).find((c) => c.id === "conhecimento:chat")?.atalho).toBe("⌘⇧K");
    expect(montarComandos({ ...com, mac: false }).find((c) => c.id === "conhecimento:grafo")?.atalho).toBe("Ctrl+Shift+G");
  });
  it("a busca acha por sinônimos", () => {
    const l = montarComandos(com);
    expect(buscarFuzzy(l, "orquestrador", textoDeBusca).some((c) => c.id === "conhecimento:orquestrar")).toBe(true);
    expect(buscarFuzzy(l, "indice", textoDeBusca).some((c) => c.id === "conhecimento:reindexar")).toBe(true);
    expect(buscarFuzzy(l, "grafo", textoDeBusca).some((c) => c.id === "conhecimento:grafo")).toBe(true);
  });
  it("executar abre a tela certa e pede o alvo pelo gancho próprio", () => {
    const telas: string[] = []; const k: PedidoConhecimento[] = []; const c: PedidoChat[] = [];
    const a = aoPedirTela((t) => telas.push(t)); const b = aoPedirConhecimento((x) => k.push(x)); const d = aoPedirChat((x) => c.push(x));
    for (const id of ["conhecimento:grafo", "conhecimento:reindexar", "conhecimento:sincronizar", "conhecimento:chat", "conhecimento:orquestrar", "conhecimento:perguntar"]) montarComandos(com).find((x) => x.id === id)!.executar();
    expect(telas).toEqual(["conhecimento", "conhecimento", "conhecimento", "chat", "chat", "chat"]);
    expect(k).toEqual(["grafo", "reindexar", "sincronizar"]);
    expect(c).toEqual(["abrir", "orquestrar", "perguntar"]);
    a(); b(); d();
  });
  it("pedido sem ouvinte (tela lazy carregando) espera o primeiro ouvinte, por pouco tempo", () => {
    vi.useFakeTimers();
    try {
      pedirChat("orquestrar");
      const recebidos: PedidoChat[] = [];
      aoPedirChat((p) => recebidos.push(p))();
      expect(recebidos).toEqual(["orquestrar"]);
      pedirConhecimento("backend");
      vi.setSystemTime(Date.now() + VALIDADE_PEDIDO_CONHECIMENTO_MS + 1);
      const velhos: PedidoConhecimento[] = [];
      aoPedirConhecimento((p) => velhos.push(p))();
      expect(velhos).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
