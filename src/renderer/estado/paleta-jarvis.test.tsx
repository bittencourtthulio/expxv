// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavegacaoJarvis } from "../casca/NavegacaoJarvis";
import { montarComandos } from "./paleta";
import { aoPedirJarvis, pedirJarvis } from "./jarvis-acoes";
import { aoPedirTela } from "./navegacao";

afterEach(cleanup);
const cmds = () => montarComandos({ mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "claro", acoes: { navegar: () => undefined, abrirProjeto: () => undefined, novaMissao: () => undefined, novoTerminal: () => undefined, alternarTema: () => undefined, irParaWorkspace: () => undefined, abrirTrabalho: () => undefined } });

describe("paleta ⌘K: Jarvis e controle remoto", () => {
  it("comandos existem e abrem as abas certas (pedido guardado se a tela lazy ainda não montou)", () => {
    const jarvis = cmds().filter((c) => c.grupo === "Jarvis");
    expect(jarvis.map((c) => c.id)).toEqual(expect.arrayContaining(["jarvis:abrir", "jarvis:remoto", "jarvis:remoto-desligar", "jarvis:auditoria"]));
    const telas: string[] = [];
    const sair = aoPedirTela((t) => telas.push(t));
    jarvis.find((c) => c.id === "jarvis:remoto")?.executar();
    sair();
    expect(telas).toEqual(["jarvis"]);
    const abas: string[] = [];
    const parar = aoPedirJarvis((p) => abas.push(p.aba)); // ouvinte tardio recebe o pedido pendente (válido por 4 s)
    parar();
    expect(abas).toEqual(["remoto"]);
  });
  it("com a tela montada o pedido vai direto; kill-switch da paleta chama `remoto.desligar` e nada mais", () => {
    const abas: string[] = [];
    const parar = aoPedirJarvis((p) => abas.push(p.aba));
    pedirJarvis("auditoria");
    pedirJarvis("conversa");
    parar();
    expect(abas).toEqual(["auditoria", "conversa"]);
    const desligar = vi.fn(async () => undefined);
    (globalThis as unknown as { ade?: unknown }).ade = { remoto: { desligar } };
    cmds().find((c) => c.id === "jarvis:remoto-desligar")?.executar();
    expect(desligar).toHaveBeenCalledTimes(1);
    delete (globalThis as unknown as { ade?: unknown }).ade;
  });
  it("`abrir_pane` do main leva à tela Terminais (e some ao desmontar)", () => {
    let cb: ((e: { ref: string }) => void) | null = null;
    const cancelar = vi.fn();
    const api = { assinarNavegacao: (f: (e: { ref: string }) => void) => ((cb = f), cancelar) };
    const telas: string[] = [];
    const sair = aoPedirTela((t) => telas.push(t));
    const { unmount } = render(<NavegacaoJarvis api={api} />);
    (cb as unknown as (e: { ref: string }) => void)({ ref: "3" });
    expect(telas).toEqual(["terminais"]);
    unmount();
    expect(cancelar).toHaveBeenCalled();
    sair();
  });
});
