import { describe, expect, it, vi } from "vitest";
import { buscarFuzzy } from "../busca-fuzzy";
import { aoPedirMemoria, pedirMemoria, VALIDADE_PEDIDO_MEMORIA_MS, type PedidoMemoria } from "./memoria-acoes";
import { aoPedirTela } from "./navegacao";
import { montarComandos, textoDeBusca, type ContextoPaleta } from "./paleta";

const acoes = { navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn() };
const sem: ContextoPaleta = { mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "escuro", acoes };
const com: ContextoPaleta = { ...sem, workspaceAtual: { id: "w1", nome: "Loja" } };

describe("paleta: comandos da Memória (T-08.28)", () => {
  it("abrir, preferências, saúde e ajustes existem sempre; restaurar e exportar só com projeto", () => {
    const g = (c: ContextoPaleta) => montarComandos(c).filter((x) => x.grupo === "Memória").map((x) => x.id);
    expect(g(sem)).toEqual(["memoria:abrir", "memoria:preferencias", "memoria:saude", "memoria:ajustes"]);
    expect(g(com)).toEqual(["memoria:abrir", "memoria:preferencias", "memoria:saude", "memoria:ajustes", "memoria:restaurar", "memoria:exportar"]);
    expect(montarComandos(com).find((c) => c.id === "memoria:abrir")?.titulo).toBe("Memória: abrir");
    expect(montarComandos(com).find((c) => c.id === "memoria:restaurar")?.titulo).toBe("Memória: restaurar painel");
  });
  it("a busca acha por sinônimos (sem acento)", () => {
    const l = montarComandos(com);
    expect(buscarFuzzy(l, "restaurar painel", textoDeBusca).some((c) => c.id === "memoria:restaurar")).toBe(true);
    expect(buscarFuzzy(l, "retencao", textoDeBusca).some((c) => c.id === "memoria:ajustes")).toBe(true);
    expect(buscarFuzzy(l, "metricas", textoDeBusca).some((c) => c.id === "memoria:saude")).toBe(true);
  });
  it("executar abre a tela Memória e pede o alvo pelo gancho próprio (nunca clique por texto)", () => {
    const telas: string[] = []; const alvos: PedidoMemoria[] = [];
    const a = aoPedirTela((t) => telas.push(t)); const b = aoPedirMemoria((x) => alvos.push(x));
    montarComandos(com).find((c) => c.id === "memoria:restaurar")!.executar();
    montarComandos(com).find((c) => c.id === "memoria:preferencias")!.executar();
    expect(telas).toEqual(["memoria", "memoria"]);
    expect(alvos).toEqual(["restaurar", "preferencias"]);
    a(); b();
  });
  it("pedido sem ouvinte (tela lazy ainda carregando) espera o primeiro ouvinte, por pouco tempo", () => {
    vi.useFakeTimers();
    try {
      pedirMemoria("saude");
      const recebidos: PedidoMemoria[] = [];
      aoPedirMemoria((p) => recebidos.push(p))();
      expect(recebidos).toEqual(["saude"]);
      pedirMemoria("saude");
      vi.advanceTimersByTime(VALIDADE_PEDIDO_MEMORIA_MS + 10);
      const tarde: PedidoMemoria[] = [];
      aoPedirMemoria((p) => tarde.push(p))();
      expect(tarde).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
