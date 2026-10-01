import { describe, expect, it, vi } from "vitest";
import { montarComandos, textoDeBusca, type AcoesPaleta, type ContextoPaleta } from "./paleta";
import { buscarFuzzy } from "../busca-fuzzy";

const acoes = (): AcoesPaleta => ({
  navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(),
  alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn(),
});
const base = (p: Partial<ContextoPaleta> = {}): ContextoPaleta => ({
  mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "escuro", acoes: acoes(), ...p,
});
const ids = (c: ContextoPaleta) => montarComandos(c).map((x) => x.id);

describe("comandos da paleta por contexto", () => {
  it("sem workspace: navega pelas 7 telas e abre projeto, mas não oferece Nova Missão nem Novo terminal", () => {
    const r = ids(base());
    expect(r.filter((i) => i.startsWith("ir:"))).toHaveLength(7);
    expect(r).toContain("abrir-projeto");
    expect(r).toContain("tema");
    expect(r).not.toContain("nova-missao");
    expect(r).not.toContain("novo-terminal");
  });
  it("com workspace: oferece Nova Missão/Novo terminal e atalho por plataforma", () => {
    const ws = { id: "w1", nome: "Loja" };
    const mac = montarComandos(base({ workspaceAtual: ws }));
    expect(mac.map((c) => c.id)).toContain("nova-missao");
    expect(mac.find((c) => c.id === "novo-terminal")?.atalho).toBe("⌘N");
    const win = montarComandos(base({ workspaceAtual: ws, mac: false }));
    expect(win.find((c) => c.id === "novo-terminal")?.atalho).toBe("Ctrl+Shift+N");
  });
  it("trabalhos do método se acham por id ou título; recentes excluem o atual; tema reflete o estado", () => {
    const c = base({
      workspaceAtual: { id: "w1", nome: "A" },
      recentes: [{ id: "w1", nome: "A" }, { id: "w2", nome: "Outro" }],
      trabalhos: [{ id: "F-042", titulo: "Checkout com Pix", tipo: "feature", estagio: "f3" }],
      temaEfetivo: "claro",
    });
    const lista = montarComandos(c);
    expect(lista.find((x) => x.id === "ws:w1")).toBeUndefined();
    expect(lista.find((x) => x.id === "ws:w2")).toBeDefined();
    expect(lista.find((x) => x.id === "tema")?.titulo).toContain("escuro");
    expect(buscarFuzzy(lista, "f-042", textoDeBusca)[0]?.id).toBe("trabalho:F-042");
    expect(buscarFuzzy(lista, "pix", textoDeBusca)[0]?.id).toBe("trabalho:F-042");
  });
  it("executar delega às ações injetadas", () => {
    const c = base({ workspaceAtual: { id: "w1", nome: "A" } });
    montarComandos(c).find((x) => x.id === "ir:metodo")?.executar();
    montarComandos(c).find((x) => x.id === "nova-missao")?.executar();
    expect(c.acoes.navegar).toHaveBeenCalledWith("metodo");
    expect(c.acoes.novaMissao).toHaveBeenCalled();
  });
});

describe("criarAcoesDom (eventos próprios, sem DOM)", () => {
  it("navegar e as ações pedem tela/ação pelo gancho de navegação", async () => {
    const nav = await import("./navegacao");
    const { criarAcoesDom } = await import("./paleta");
    const telas: string[] = [];
    const cancelarTela = nav.aoPedirTela((t) => telas.push(t));
    const missao = vi.fn();
    const terminal = vi.fn();
    const c1 = nav.aoPedirAcao("nova-missao", missao);
    const c2 = nav.aoPedirAcao("novo-terminal", terminal);
    const a = criarAcoesDom({ abrirProjeto: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn() });
    a.navegar("metodo");
    a.novaMissao();
    a.novoTerminal();
    expect(telas).toEqual(["metodo", "missoes", "terminais"]);
    expect(missao).toHaveBeenCalledTimes(1);
    expect(terminal).toHaveBeenCalledTimes(1);
    cancelarTela(); c1(); c2();
  });
});
