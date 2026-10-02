import { describe, expect, it, vi } from "vitest";
import { buscarFuzzy } from "../busca-fuzzy";
import { aoPedirCatalogo } from "./catalogo-acoes";
import { aoPedirLojaMcp } from "./loja-mcp-acoes";
import { aoPedirTela } from "./navegacao";
import { montarComandos, textoDeBusca, type ContextoPaleta } from "./paleta";

const ctx: ContextoPaleta = { mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "escuro", acoes: { navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn() } };

describe("paleta: Catálogo e Gateway", () => {
  it("comandos existem sem depender de workspace e são achados por busca", () => {
    const todos = montarComandos(ctx);
    const ids = todos.filter((c) => c.id.startsWith("catalogo:")).map((c) => c.id);
    expect(ids).toEqual(["catalogo:abrir", "catalogo:atualizar", "catalogo:politica"]);
    expect(todos.some((c) => c.id === "gateway:abrir" && c.titulo === "Gateway MCP: abrir")).toBe(true);
    expect(todos.some((c) => c.id === "ir:catalogo" && c.titulo === "Ir para Catálogo")).toBe(true);
    expect(buscarFuzzy(todos, "varrer skills", textoDeBusca).some((c) => c.id === "catalogo:atualizar")).toBe(true);
  });
  it("executar abre a tela e entrega o alvo à tela dona", () => {
    const telas: string[] = []; const alvos: string[] = []; const gw: string[] = [];
    const a = aoPedirTela((t) => telas.push(t)); const b = aoPedirCatalogo((x) => alvos.push(x)); const c = aoPedirLojaMcp((x) => gw.push(x));
    const todos = montarComandos(ctx);
    todos.find((x) => x.id === "catalogo:atualizar")!.executar();
    todos.find((x) => x.id === "gateway:abrir")!.executar();
    expect(telas).toEqual(["catalogo", "loja-mcp"]);
    expect(alvos).toEqual(["atualizar"]);
    expect(gw).toEqual(["gateway"]);
    a(); b(); c();
  });
});
