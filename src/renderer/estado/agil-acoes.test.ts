import { afterEach, describe, expect, it, vi } from "vitest";
import { aoPedirTela } from "./navegacao";
import { aoPedirAgil, ligarAtalhosAgil, pedidoDoAtalho, pedirAgil } from "./agil-acoes";
import { montarComandos, type ContextoPaleta } from "./paleta";

const tecla = (o: Partial<Parameters<typeof pedidoDoAtalho>[0]>) => ({ key: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });
afterEach(() => vi.useRealTimers());

describe("atalhos da gestão ágil", () => {
  it("⌘⇧A abre, ⌘⌥D daily, ⌘⌥R retro (mac) e as variantes de Ctrl (Windows)", () => {
    expect(pedidoDoAtalho(tecla({ key: "a", code: "KeyA", metaKey: true, shiftKey: true }), true)).toBe("abrir");
    expect(pedidoDoAtalho(tecla({ key: "∂", code: "KeyD", metaKey: true, altKey: true }), true)).toBe("daily");
    expect(pedidoDoAtalho(tecla({ key: "®", code: "KeyR", metaKey: true, altKey: true }), true)).toBe("retro");
    expect(pedidoDoAtalho(tecla({ key: "d", code: "KeyD", ctrlKey: true, altKey: true }), false)).toBe("daily");
    expect(pedidoDoAtalho(tecla({ key: "a", code: "KeyA", ctrlKey: true, shiftKey: true }), false)).toBe("abrir");
  });
  it("nada dispara sem o modificador certo ou com combinação alheia", () => {
    expect(pedidoDoAtalho(tecla({ key: "a", code: "KeyA", shiftKey: true }), true)).toBeNull();
    expect(pedidoDoAtalho(tecla({ key: "a", code: "KeyA", ctrlKey: true, shiftKey: true }), true)).toBeNull();
    expect(pedidoDoAtalho(tecla({ key: "a", code: "KeyA", metaKey: true }), true)).toBeNull();
    expect(pedidoDoAtalho(tecla({ key: "d", code: "KeyD", metaKey: true, altKey: true, shiftKey: true }), true)).toBeNull();
  });
  it("o ouvinte global pede a tela e o pedido espera o primeiro ouvinte (tela lazy)", () => {
    const telas: string[] = [];
    const des = aoPedirTela((t) => telas.push(t));
    const alvo = new EventTarget() as unknown as Pick<Window, "addEventListener" | "removeEventListener">;
    const solto = ligarAtalhosAgil(alvo, true);
    const ev = Object.assign(new Event("keydown", { cancelable: true }), { key: "r", code: "KeyR", metaKey: true, ctrlKey: false, shiftKey: false, altKey: true });
    (alvo as unknown as EventTarget).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(telas).toEqual(["agil"]);
    const recebidos: string[] = [];
    const parar = aoPedirAgil((p) => recebidos.push(p));
    expect(recebidos).toEqual(["retro"]);
    pedirAgil("daily");
    expect(recebidos).toEqual(["retro", "daily"]);
    parar(); solto(); des();
  });
  it("o pedido pendente expira", () => {
    vi.useFakeTimers();
    pedirAgil("backlog");
    vi.advanceTimersByTime(5_000);
    const r: string[] = [];
    const parar = aoPedirAgil((p) => r.push(p));
    expect(r).toEqual([]);
    parar();
  });
});

describe("paleta ⌘K", () => {
  const acoes = { navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn() };
  const ctx: ContextoPaleta = { mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "escuro", acoes };
  it("registra os comandos da gestão ágil com atalhos", () => {
    const l = montarComandos(ctx).filter((c) => c.grupo === "Gestão ágil");
    expect(l.map((c) => c.id)).toEqual(expect.arrayContaining(["agil:abrir", "agil:painel", "agil:backlog", "agil:sprint", "agil:daily", "agil:retro", "agil:qualidade", "agil:sincronizar"]));
    expect(l.find((c) => c.id === "agil:abrir")?.atalho).toBe("⌘⇧A");
    expect(montarComandos({ ...ctx, mac: false }).find((c) => c.id === "agil:daily")?.atalho).toBe("Ctrl+Alt+D");
  });
});
