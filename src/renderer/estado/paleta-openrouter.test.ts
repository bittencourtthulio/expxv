import { describe, expect, it, vi } from "vitest";
import { buscarFuzzy } from "../busca-fuzzy";
import { aoPedirTela } from "./navegacao";
import { aoPedirOpenRouter } from "./openrouter-acoes";
import { montarComandos, textoDeBusca, type ContextoPaleta } from "./paleta";

const ctx: ContextoPaleta = { mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "escuro", acoes: { navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn() } };

describe("paleta: comandos do OpenRouter", () => {
  it("existem no grupo Consumo e harness, sem depender de workspace, e são achados por 'openrouter'", () => {
    const l = montarComandos(ctx).filter((c) => c.id.startsWith("openrouter:"));
    expect(l.map((c) => c.id)).toEqual(["openrouter:abrir", "openrouter:chave", "openrouter:modelos"]);
    expect(l.every((c) => c.grupo === "Consumo e harness")).toBe(true);
    const achados = buscarFuzzy(montarComandos(ctx), "openrouter", textoDeBusca);
    expect(achados.length).toBeGreaterThanOrEqual(3);
  });
  it("executar abre Provedores e pede o alvo à seção", () => {
    const telas: string[] = []; const alvos: string[] = [];
    const a = aoPedirTela((t) => telas.push(t)); const b = aoPedirOpenRouter((x) => alvos.push(x));
    montarComandos(ctx).find((c) => c.id === "openrouter:chave")!.executar();
    expect(telas).toEqual(["provedores"]); expect(alvos).toEqual(["chave"]);
    a(); b();
  });
});
