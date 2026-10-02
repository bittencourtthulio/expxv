import { describe, expect, it, vi } from "vitest";
import { buscarFuzzy } from "../busca-fuzzy";
import { aoPedirLojaMcp } from "./loja-mcp-acoes";
import { aoPedirTela } from "./navegacao";
import { montarComandos, textoDeBusca, type ContextoPaleta } from "./paleta";

const ctx: ContextoPaleta = { mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "escuro", acoes: { navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn() } };

describe("paleta: comandos da Loja de MCPs", () => {
  it("existem no grupo próprio, sem depender de workspace, e são achados por 'mcp'", () => {
    const l = montarComandos(ctx).filter((c) => c.id.startsWith("loja-mcp:"));
    expect(l.map((c) => c.id)).toEqual(["loja-mcp:abrir", "loja-mcp:kit"]);
    expect(l.every((c) => c.grupo === "Loja de MCPs")).toBe(true);
    expect(buscarFuzzy(montarComandos(ctx), "kit mcp", textoDeBusca).some((c) => c.id === "loja-mcp:kit")).toBe(true);
  });
  it("'Ir para Loja de MCPs' existe na navegação", () => {
    expect(montarComandos(ctx).some((c) => c.id === "ir:loja-mcp" && c.titulo === "Ir para Loja de MCPs")).toBe(true);
  });
  it("executar abre a tela e entrega o alvo à tela dona", () => {
    const telas: string[] = []; const alvos: string[] = [];
    const a = aoPedirTela((t) => telas.push(t)); const b = aoPedirLojaMcp((x) => alvos.push(x));
    montarComandos(ctx).find((c) => c.id === "loja-mcp:kit")!.executar();
    expect(telas).toEqual(["loja-mcp"]); expect(alvos).toEqual(["kit"]);
    a(); b();
  });
});
