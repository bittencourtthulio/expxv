// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { montarComandos } from "../estado/paleta";

describe("paleta", () => {
  it("comandos de alertas existem e o pânico só pede o diálogo", () => {
    const cmds = montarComandos({ mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "claro", acoes: { navegar: () => undefined, abrirProjeto: () => undefined, novaMissao: () => undefined, novoTerminal: () => undefined, alternarTema: () => undefined, irParaWorkspace: () => undefined, abrirTrabalho: () => undefined } });
    const ids = cmds.filter((c) => c.grupo === "Alertas").map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["alertas:abrir", "alertas:lidos", "alertas:silenciar", "alertas:panico"]));
    const titulos = cmds.map((c) => c.titulo);
    expect(titulos).toContain("Abrir Centro de Alertas");
    expect(titulos).toContain("Marcar alertas como lidos");
    expect(titulos).toContain("Silenciar alertas por 1 h");
    expect(titulos).toContain("Telegram: pânico (parar tudo)");
    const ouvinte = vi.fn();
    const g = globalThis as unknown as { ade?: unknown };
    g.ade = { alertas: { telegram: { panico: ouvinte } } };
    cmds.find((c) => c.id === "alertas:panico")?.executar();
    expect(ouvinte).not.toHaveBeenCalled();
    delete g.ade;
  });
});
