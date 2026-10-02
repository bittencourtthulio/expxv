// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { montarComandos } from "./paleta";
import { aoPedirJarvis } from "./jarvis-acoes";

const cmds = () => montarComandos({ mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "claro", acoes: { navegar: () => undefined, abrirProjeto: () => undefined, novaMissao: () => undefined, novoTerminal: () => undefined, alternarTema: () => undefined, irParaWorkspace: () => undefined, abrirTrabalho: () => undefined } });
afterEach(() => void delete (globalThis as unknown as { ade?: unknown }).ade);

describe("paleta ⌘K: relay", () => {
  it("abrir e parear levam à aba Relay; pânico chama `relay.panico` e mais nada", () => {
    const ids = cmds().filter((c) => c.grupo === "Jarvis").map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["relay:abrir", "relay:parear", "relay:panico"]));
    const abas: string[] = [];
    const parar = aoPedirJarvis((p) => abas.push(p.aba));
    cmds().find((c) => c.id === "relay:abrir")?.executar();
    cmds().find((c) => c.id === "relay:parear")?.executar();
    parar();
    expect(abas).toEqual(["relay", "relay"]);
    const panico = vi.fn(async () => ({ ok: true }));
    (globalThis as unknown as { ade?: unknown }).ade = { relay: { panico } };
    cmds().find((c) => c.id === "relay:panico")?.executar();
    expect(panico).toHaveBeenCalledTimes(1);
  });
  it("sem a API (fora do app) o pânico não quebra", () => {
    expect(() => cmds().find((c) => c.id === "relay:panico")?.executar()).not.toThrow();
  });
});
