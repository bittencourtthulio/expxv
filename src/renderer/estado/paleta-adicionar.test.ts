import { afterEach, describe, expect, it, vi } from "vitest";
import { storeAdicionarWorkspace } from "./adicionar-workspace";
import { buscarFuzzy } from "../busca-fuzzy";
import { montarComandos, textoDeBusca, type AcoesPaleta, type ContextoPaleta } from "./paleta";

const acoes = (): AcoesPaleta => ({ navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn() });
const base = (p: Partial<ContextoPaleta> = {}): ContextoPaleta => ({ mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "escuro", acoes: acoes(), ...p });

afterEach(() => storeAdicionarWorkspace.fechar());

describe("paleta (⌘K): Adicionar workspace (D-600…)", () => {
  it("oferece 'Adicionar workspace…', 'Clonar repositório…' e 'Novo projeto…' mesmo sem workspace aberto", () => {
    const lista = montarComandos(base());
    expect(lista.find((c) => c.id === "adicionar-workspace")).toMatchObject({ titulo: "Adicionar workspace…", atalho: "⌘⇧O" });
    expect(lista.find((c) => c.id === "adicionar-workspace:clonar")?.titulo).toBe("Clonar repositório…");
    expect(lista.find((c) => c.id === "adicionar-workspace:novo")?.titulo).toBe("Novo projeto…");
    expect(montarComandos(base({ mac: false })).find((c) => c.id === "adicionar-workspace")?.atalho).toBe("Ctrl+Shift+O");
  });
  it("cada comando abre o modal JÁ na seção certa", () => {
    const lista = montarComandos(base());
    lista.find((c) => c.id === "adicionar-workspace:clonar")?.executar();
    expect(storeAdicionarWorkspace.obter()).toMatchObject({ aberto: true, secao: "clonar" });
    lista.find((c) => c.id === "adicionar-workspace:novo")?.executar();
    expect(storeAdicionarWorkspace.obter().secao).toBe("novo");
    lista.find((c) => c.id === "adicionar-workspace")?.executar();
    expect(storeAdicionarWorkspace.obter().secao).toBe("pasta");
  });
  it("'Abrir pasta…' continua direto ao diálogo nativo (ação injetada), não ao modal", () => {
    const a = acoes();
    const lista = montarComandos(base({ acoes: a }));
    const c = lista.find((x) => x.id === "abrir-projeto");
    expect(c).toMatchObject({ titulo: "Abrir pasta…", atalho: "⌘O" });
    c?.executar();
    expect(a.abrirProjeto).toHaveBeenCalledTimes(1);
    expect(storeAdicionarWorkspace.obter().aberto).toBe(false);
  });
  it("se acham por sinônimos (clonar, git, github, criar)", () => {
    const lista = montarComandos(base());
    expect(buscarFuzzy(lista, "clonar", textoDeBusca)[0]?.id).toBe("adicionar-workspace:clonar");
    expect(buscarFuzzy(lista, "github", textoDeBusca).map((c) => c.id)).toContain("adicionar-workspace:clonar");
    expect(buscarFuzzy(lista, "novo projeto", textoDeBusca)[0]?.id).toBe("adicionar-workspace:novo");
  });
});
