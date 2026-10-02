import { describe, expect, it, vi } from "vitest";
import { buscarFuzzy } from "../busca-fuzzy";
import { aoPedirMaestro, pedirMaestro, VALIDADE_PEDIDO_MAESTRO_MS, type PedidoDeAbertura } from "./maestro-acoes";
import { aoPedirTela } from "./navegacao";
import { montarComandos, textoDeBusca, type ContextoPaleta } from "./paleta";
import { interpretarAtalho } from "../telas/terminais/atalhos";

const acoes = { navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn() };
const sem: ContextoPaleta = { mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "escuro", acoes };
const com: ContextoPaleta = { ...sem, workspaceAtual: { id: "w1", nome: "Loja" } };

describe("paleta: Maestro (T-16.29)", () => {
  it("'Pedir ao Maestro…' só com projeto aberto; pipelines e rigidez sempre", () => {
    const g = (c: ContextoPaleta) => montarComandos(c).filter((x) => x.grupo === "Maestro").map((x) => x.id);
    expect(g(sem)).toEqual(["maestro:pipelines", "maestro:rigidez"]);
    expect(g(com)).toEqual(["maestro:pedir", "maestro:pipelines", "maestro:rigidez"]);
    expect(montarComandos(com).find((c) => c.id === "maestro:pedir")?.atalho).toBe("⌘⇧E");
    expect(montarComandos({ ...com, mac: false }).find((c) => c.id === "maestro:pedir")?.atalho).toBe("Ctrl+Shift+E");
  });
  it("a busca acha por sinônimos", () => {
    const l = montarComandos(com);
    expect(buscarFuzzy(l, "corrigir bug", textoDeBusca).some((c) => c.id === "maestro:pedir")).toBe(true);
    expect(buscarFuzzy(l, "rigidez", textoDeBusca).some((c) => c.id === "maestro:rigidez")).toBe(true);
  });
  it("executar abre o campo pelo gancho próprio; pipelines leva à tela", () => {
    const telas: string[] = []; const pedidos: PedidoDeAbertura[] = [];
    const a = aoPedirTela((t) => telas.push(t)); const b = aoPedirMaestro((p) => pedidos.push(p));
    montarComandos(com).find((c) => c.id === "maestro:pedir")!.executar();
    montarComandos(com).find((c) => c.id === "maestro:pipelines")!.executar();
    expect(pedidos).toEqual([{ contexto: null, origem: null }]);
    expect(telas).toEqual(["pipelines"]);
    a(); b();
  });
  it("pedido sem ouvinte espera o primeiro ouvinte, por pouco tempo", () => {
    vi.useFakeTimers();
    try {
      pedirMaestro({ pane_id: "p1", mission_id: "m1", trabalho_id: null, arquivos: [], trecho: null }, "painel #1");
      const recebidos: PedidoDeAbertura[] = [];
      aoPedirMaestro((p) => recebidos.push(p))();
      expect(recebidos).toHaveLength(1);
      expect(recebidos[0]?.origem).toBe("painel #1");
      pedirMaestro();
      vi.advanceTimersByTime(VALIDADE_PEDIDO_MAESTRO_MS + 1);
      const tarde: PedidoDeAbertura[] = [];
      aoPedirMaestro((p) => tarde.push(p))();
      expect(tarde).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});

// KeyboardEvent só existe com jsdom: o atalho é testado com objeto simples (a função só lê campos)
const ev = (init: Partial<Record<"key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey", unknown>>) => ({ type: "keydown", key: "", code: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init }) as never;
describe("atalho ⌘⇧E / Ctrl+Shift+E", () => {
  it("mac usa Cmd+Shift; os demais Ctrl+Shift; sem Shift não dispara", () => {
    expect(interpretarAtalho(ev({ key: "E", metaKey: true, shiftKey: true }), true)).toEqual({ tipo: "maestro" });
    expect(interpretarAtalho(ev({ key: "e", metaKey: true }), true)).toBeNull();
    expect(interpretarAtalho(ev({ key: "E", ctrlKey: true, shiftKey: true }), false)).toEqual({ tipo: "maestro" });
    expect(interpretarAtalho(ev({ key: "e", ctrlKey: true }), false)).toBeNull();
  });
});
