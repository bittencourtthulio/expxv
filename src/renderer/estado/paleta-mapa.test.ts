// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { montarComandos } from "./paleta";
import { aoPedirMapa, pedirMapa } from "./mapa-acoes";

const acoes = { navegar: () => undefined, abrirProjeto: () => undefined, novaMissao: () => undefined, novoTerminal: () => undefined, alternarTema: () => undefined, irParaWorkspace: () => undefined, abrirTrabalho: () => undefined };

describe("paleta: Mapa do código", () => {
  const cmds = montarComandos({ mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "claro", acoes });
  it("registra os comandos do Mapa e 'Ir para Mapa'", () => {
    const ids = cmds.filter((c) => c.grupo === "Mapa").map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["mapa:abrir", "mapa:analisar", "mapa:atualizar", "mapa:buscar", "mapa:hotspots", "mapa:ciclos", "mapa:perfil"]));
    expect(cmds.map((c) => c.titulo)).toContain("Ir para Mapa");
    expect(cmds.map((c) => c.titulo)).toContain("Mapa: buscar símbolo");
  });
  it("o comando só pede à tela (não analisa por conta própria); pedido sem ouvinte espera o primeiro", () => {
    pedirMapa("analisar");
    const ouvinte = vi.fn();
    const sair = aoPedirMapa(ouvinte);
    expect(ouvinte).toHaveBeenCalledWith("analisar");
    cmds.find((c) => c.id === "mapa:buscar")?.executar();
    expect(ouvinte).toHaveBeenLastCalledWith("buscar");
    sair();
  });
});
