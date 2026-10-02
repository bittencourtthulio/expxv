// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montarComandos } from "./paleta";

describe("paleta: medidor de CPU e memória", () => {
  it("tem o comando 'Mostrar/ocultar medidor de CPU e memória' com atalho", () => {
    const cmds = montarComandos({ mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "claro", acoes: { navegar: () => undefined, abrirProjeto: () => undefined, novaMissao: () => undefined, novoTerminal: () => undefined, alternarTema: () => undefined, irParaWorkspace: () => undefined, abrirTrabalho: () => undefined } });
    const c = cmds.find((x) => x.id === "sistema:medidor");
    expect(c?.titulo).toBe("Mostrar/ocultar medidor de CPU e memória");
    expect(c?.atalho).toBe("⌘⌥U");
    expect(c?.busca).toContain("cpu");
  });
});
