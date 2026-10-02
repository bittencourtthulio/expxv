import { describe, expect, it, vi } from "vitest";
import { storeExecutar } from "./executar";
import { aoPedirExecutar } from "./executar-acoes";
import { montarComandos, type ContextoPaleta } from "./paleta";

const acoes = { navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn() };
const ctx = (extra: Partial<ContextoPaleta> = {}): ContextoPaleta => ({ mac: false, workspaceAtual: { id: "ws_AAAAAAAAAAAA", nome: "Meu app" }, recentes: [], trabalhos: [], temaEfetivo: "escuro", acoes, ...extra });

describe("paleta ⌘K: Executar projeto", () => {
  it("com workspace: Executar, Parar, Reiniciar, Executar configuração… e Editar, com atalhos", () => {
    const ids = montarComandos(ctx()).filter((c) => c.grupo === "Executar");
    expect(ids.map((c) => c.titulo)).toEqual(["Executar projeto", "Parar execução", "Reiniciar execução", "Executar configuração…", "Editar configurações de execução…"]);
    expect(ids[0]).toMatchObject({ id: "executar:executar", atalho: "F5", detalhe: "Meu app" });
    expect(ids[1]!.atalho).toBe("Shift+F5");
    expect(ids[2]!.atalho).toBe("Ctrl+Shift+F5");
  });
  it("no macOS o atalho cita o equivalente com ⌘ (F5 exige fn)", () => {
    const ids = montarComandos(ctx({ mac: true })).filter((c) => c.grupo === "Executar");
    expect(ids.map((c) => c.atalho)).toEqual(["F5 · ⌘R", "⇧F5 · ⌘.", "⌘⇧F5 · ⌘⇧R", undefined, undefined]);
  });
  it("sem workspace nada de Executar", () => {
    expect(montarComandos(ctx({ workspaceAtual: null })).some((c) => c.grupo === "Executar")).toBe(false);
  });
  it("os comandos chamam o store; 'Executar configuração…' abre o menu do botão", () => {
    const e = vi.spyOn(storeExecutar, "executar").mockResolvedValue();
    const p = vi.spyOn(storeExecutar, "parar").mockResolvedValue();
    const r = vi.spyOn(storeExecutar, "reiniciar").mockResolvedValue();
    const ed = vi.spyOn(storeExecutar, "abrirEditor").mockReturnValue();
    const pedidos: string[] = [];
    const desligar = aoPedirExecutar((x) => pedidos.push(x));
    const por = Object.fromEntries(montarComandos(ctx()).filter((c) => c.grupo === "Executar").map((c) => [c.id, c]));
    por["executar:executar"]!.executar();
    por["executar:parar"]!.executar();
    por["executar:reiniciar"]!.executar();
    por["executar:escolher"]!.executar();
    por["executar:editar"]!.executar();
    desligar();
    expect([e, p, r].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
    expect(ed).toHaveBeenCalledWith("editar");
    expect(pedidos).toEqual(["escolher"]);
    vi.restoreAllMocks();
  });
});
