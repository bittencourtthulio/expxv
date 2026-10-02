// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ResumoWorkspaces } from "../../compartilhado/workspaces-resumo";
import { COALESCER_RESUMO_MS, criarStorePainelWorkspaces } from "./painel-workspaces";
import { ehAtalhoDoPainelWorkspaces, ligarAtalhoPainelWorkspaces } from "./painel-workspaces-acoes";

const R = (n: number): ResumoWorkspaces => ({ versao: 1, gerado_em: n, itens: [] });
function montar() {
  let ao: ((r: ResumoWorkspaces) => void) | null = null;
  const cancelar = vi.fn();
  const api = {
    resumo: vi.fn(async () => R(1)),
    ativarResumo: vi.fn(async (a: boolean) => a),
    assinarResumo: vi.fn((cb: (r: ResumoWorkspaces) => void) => { ao = cb; return cancelar; }),
    encerrarAgente: vi.fn(async () => ({ ok: true, motivo: "encerrado" as const })),
    revelar: vi.fn(async () => true),
    copiarCaminho: vi.fn(async () => true),
  };
  const mem = new Map<string, string>();
  const store = criarStorePainelWorkspaces({ api: () => api as never, armazem: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) } });
  return { api, store, mem, emitir: (r: ResumoWorkspaces) => ao?.(r), cancelar };
}

describe("store do painel de workspaces", () => {
  it("nada no boot: criar o store não chama o main nem assina nada", () => {
    const m = montar();
    expect(m.api.resumo).not.toHaveBeenCalled();
    expect(m.api.ativarResumo).not.toHaveBeenCalled();
    expect(m.api.assinarResumo).not.toHaveBeenCalled();
    expect(m.store.obter()).toMatchObject({ ativo: false, resumo: null });
  });

  it("ativar assina, avisa o main e lê o primeiro resumo; é idempotente", async () => {
    const m = montar();
    await m.store.ativar();
    await m.store.ativar();
    expect(m.api.assinarResumo).toHaveBeenCalledTimes(1);
    expect(m.api.ativarResumo).toHaveBeenCalledWith(true);
    expect(m.store.obter()).toMatchObject({ ativo: true, resumo: { gerado_em: 1 }, carregando: false });
  });

  it("desativar solta a assinatura e avisa o main; evento tardio é ignorado", async () => {
    vi.useFakeTimers();
    const m = montar();
    await m.store.ativar();
    m.emitir(R(7));
    m.store.desativar();
    expect(m.cancelar).toHaveBeenCalled();
    expect(m.api.ativarResumo).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(COALESCER_RESUMO_MS * 4);
    expect(m.store.obter().resumo?.gerado_em).toBe(1);
    vi.useRealTimers();
  });

  it("coalesce rajadas de eventos (≥ 250 ms) numa só atualização com o último", async () => {
    vi.useFakeTimers();
    const m = montar();
    await m.store.ativar();
    const ouvinte = vi.fn();
    m.store.assinar(ouvinte);
    for (let i = 10; i < 60; i += 1) m.emitir(R(i));
    expect(ouvinte).not.toHaveBeenCalled();
    vi.advanceTimersByTime(COALESCER_RESUMO_MS + 1);
    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(m.store.obter().resumo?.gerado_em).toBe(59);
    expect(COALESCER_RESUMO_MS).toBeGreaterThanOrEqual(250);
    vi.useRealTimers();
  });

  it("falha do main vira erro legível, sem lançar", async () => {
    const m = montar();
    m.api.resumo.mockRejectedValueOnce(new Error("sem daemon"));
    await m.store.ativar();
    expect(m.store.obter().erro).toContain("sem daemon");
    expect(m.store.obter().carregando).toBe(false);
  });

  it("sem ponte (navegador) o painel marca indisponível", async () => {
    const store = criarStorePainelWorkspaces({ api: () => undefined, armazem: null });
    await store.ativar();
    expect(store.obter().disponivel).toBe(false);
  });

  it("preferências são persistidas a cada mudança e relidas por um store novo", () => {
    const m = montar();
    m.store.alternarFixado();
    m.store.definirLargura(9999);
    m.store.alternarFavorito("ws_a");
    m.store.definirOrdem(["ws_b", "ws_a"]);
    m.store.recolherTodos(["ws_a"]);
    m.store.definirModo("compacto");
    const novo = criarStorePainelWorkspaces({ api: () => m.api as never, armazem: { getItem: (k) => m.mem.get(k) ?? null, setItem: () => undefined } });
    expect(novo.obter().prefs).toEqual({ fixado: true, largura: 360, ordem: ["ws_b", "ws_a"], favoritos: ["ws_a"], recolhidos: ["ws_a"], modo: "compacto" });
    m.store.expandirTodos();
    expect(m.store.obter().prefs.recolhidos).toEqual([]);
  });

  it("encerrar agente delega ao main e atualiza; falha vira resultado, não exceção", async () => {
    const m = montar();
    await m.store.ativar();
    expect(await m.store.encerrarAgente("ws_a", "sessao_x")).toEqual({ ok: true, motivo: "encerrado" });
    expect(m.api.encerrarAgente).toHaveBeenCalledWith("ws_a", "sessao_x");
    m.api.encerrarAgente.mockRejectedValueOnce(new Error("x"));
    expect((await m.store.encerrarAgente("ws_a", "sessao_x")).ok).toBe(false);
    expect(m.store.obter().erro).toContain("terminar");
  });
});

describe("atalho do painel (⌘⌥W / Ctrl+Alt+W)", () => {
  const tecla = (extra: Partial<KeyboardEvent> = {}) => ({ key: "∑", code: "KeyW", metaKey: true, ctrlKey: false, shiftKey: false, altKey: true, ...extra });
  it("reconhece só a combinação certa por plataforma", () => {
    expect(ehAtalhoDoPainelWorkspaces(tecla(), true)).toBe(true);
    expect(ehAtalhoDoPainelWorkspaces(tecla({ shiftKey: true }), true)).toBe(false);
    expect(ehAtalhoDoPainelWorkspaces(tecla({ altKey: false }), true)).toBe(false);
    expect(ehAtalhoDoPainelWorkspaces(tecla({ code: "KeyQ" }), true)).toBe(false);
    expect(ehAtalhoDoPainelWorkspaces(tecla({ metaKey: false, ctrlKey: true }), false)).toBe(true);
    expect(ehAtalhoDoPainelWorkspaces(tecla({ metaKey: false, ctrlKey: true }), true)).toBe(false);
  });
  it("o ouvinte alterna o fixado, em captura, e é desligável", () => {
    const m = montar();
    const alvo = window;
    const desligar = ligarAtalhoPainelWorkspaces(m.store, alvo, true);
    const evento = (): Event => new KeyboardEvent("keydown", { cancelable: true, key: "∑", code: "KeyW", metaKey: true, altKey: true });
    alvo.dispatchEvent(evento());
    expect(m.store.obter().prefs.fixado).toBe(true);
    alvo.dispatchEvent(evento());
    expect(m.store.obter().prefs.fixado).toBe(false);
    desligar();
    alvo.dispatchEvent(evento());
    expect(m.store.obter().prefs.fixado).toBe(false);
  });
});
