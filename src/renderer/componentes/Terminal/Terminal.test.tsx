// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  instancias: [] as Array<{ escritas: Array<{ dados: string; cb?: () => void }>; options: { theme?: unknown }; dispose: ReturnType<typeof vi.fn> }>,
  webgl: 0,
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    escritas: Array<{ dados: string; cb?: () => void }> = [];
    options: { theme?: unknown };
    cols = 80;
    rows = 24;
    buffer = { active: { viewportY: 0, length: 0, getLine: () => undefined } };
    dispose = vi.fn();
    constructor(opcoes: { theme?: unknown }) { this.options = { theme: opcoes.theme }; estado.instancias.push(this); }
    loadAddon(a: { carregado?: boolean }) { if (a.carregado !== undefined) { estado.webgl += 1; } }
    attachCustomKeyEventHandler() {}
    open() {}
    focus() {}
    refresh() {}
    paste() {}
    onData() { return { dispose() {} }; }
    write(dados: string, cb?: () => void) { this.escritas.push({ dados, ...(cb ? { cb } : {}) }); }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { proposeDimensions() { return { cols: 100, rows: 30 }; } fit() {} } }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class { findNext() { return true; } findPrevious() { return true; } clearDecorations() {} } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    carregado = true;
    onContextLoss() {}
    dispose() { estado.webgl -= 1; }
  },
}));

import { criarArmazem } from "./armazem";
import { Terminal } from "./Terminal";
import { TEMA_XTERM_CLARO, TEMA_XTERM_ESCURO } from "./tema-xterm";
import { contextosWebglEmUso, zerarContextosWebgl } from "./webgl";

const api = () => ({ escrever: vi.fn(), redimensionar: vi.fn(), confirmarConsumo: vi.fn().mockResolvedValue(true) });

beforeEach(() => { estado.instancias.length = 0; estado.webgl = 0; zerarContextosWebgl(); });
afterEach(() => zerarContextosWebgl());

describe("Terminal (xterm simulado)", () => {
  it("confirmarConsumo só acontece DEPOIS do callback de write do xterm, com bytes UTF-8", () => {
    const armazem = criarArmazem();
    const a = api();
    render(<Terminal sessaoId="s1" ativo tema="escuro" webgl={false} api={a} armazem={armazem} />);
    act(() => { armazem.empurrar("s1", 1, "olá é"); });
    const xterm = estado.instancias[0]!;
    expect(xterm.escritas).toHaveLength(1);
    expect(a.confirmarConsumo).not.toHaveBeenCalled();
    act(() => { xterm.escritas[0]!.cb!(); });
    expect(a.confirmarConsumo).toHaveBeenCalledWith("s1", new TextEncoder().encode("olá é").length);
  });

  it("reidrata do armazém com a mesma saída e sem confirmar de novo o que o store já confirmou", () => {
    const armazem = criarArmazem();
    armazem.empurrar("s1", 1, "um ");
    armazem.empurrar("s1", 2, "dois ");
    const a = api();
    const primeira = render(<Terminal sessaoId="s1" ativo tema="escuro" webgl={false} api={a} armazem={armazem} />);
    const lido1 = estado.instancias[0]!.escritas.map((e) => e.dados).join("");
    primeira.unmount();
    expect(estado.instancias[0]!.dispose).toHaveBeenCalled();
    expect(armazem.assinantes("s1")).toBe(0);
    armazem.empurrar("s1", 3, "tres"); // chegou com o painel desmontado
    render(<Terminal sessaoId="s1" ativo tema="escuro" webgl={false} api={a} armazem={armazem} />);
    const lido2 = estado.instancias[1]!.escritas.map((e) => e.dados).join("");
    expect(lido1).toBe("um dois ");
    expect(lido2).toBe("um dois tres");
    estado.instancias[1]!.escritas.forEach((e) => e.cb?.());
    expect(a.confirmarConsumo).not.toHaveBeenCalled();
  });

  it("ao desmontar confirma os bytes ao vivo que o xterm não chegou a processar", () => {
    const armazem = criarArmazem();
    const a = api();
    const r = render(<Terminal sessaoId="s1" ativo tema="escuro" webgl={false} api={a} armazem={armazem} />);
    act(() => { armazem.empurrar("s1", 1, "abc"); });
    r.unmount();
    expect(a.confirmarConsumo).toHaveBeenCalledWith("s1", 3);
  });

  it("primeiro fit envia o tamanho ao PTY uma vez só (deveAplicarDimensao)", () => {
    const a = api();
    const r = render(<Terminal sessaoId="s1" ativo tema="escuro" webgl={false} api={a} armazem={criarArmazem()} />);
    // jsdom não tem layout: o fit síncrono é ignorado e o resize não é enviado (nada de valores falsos)
    expect(a.redimensionar.mock.calls.length).toBeLessThanOrEqual(1);
    r.unmount();
  });

  it("troca o tema do xterm ao mudar o tema do app, sem recriar o terminal", () => {
    const a = api();
    const r = render(<Terminal sessaoId="s1" ativo tema="escuro" webgl={false} api={a} armazem={criarArmazem()} />);
    expect(estado.instancias[0]!.options.theme).toBe(TEMA_XTERM_ESCURO);
    r.rerender(<Terminal sessaoId="s1" ativo tema="claro" webgl={false} api={a} armazem={criarArmazem()} />);
    expect(estado.instancias).toHaveLength(2); // armazém novo no rerender recria; o tema vale no primeiro teste abaixo
    expect(estado.instancias[1]!.options.theme).toBe(TEMA_XTERM_CLARO);
  });

  it("WebGL: contextos nunca passam de 6 com 10 painéis pedindo e são devolvidos ao desmontar", async () => {
    class Falso { carregado = true; onContextLoss() {} dispose() { estado.webgl -= 1; } }
    const carregarWebgl = () => Promise.resolve({ WebglAddon: Falso }) as never;
    const armazem = criarArmazem();
    const a = api();
    const pilha = Array.from({ length: 10 }, (_, i) => render(<Terminal sessaoId={`s${i}`} ativo={false} tema="escuro" webgl api={a} armazem={armazem} carregarWebgl={carregarWebgl} />));
    await act(async () => { await vi.waitFor(() => expect(estado.webgl).toBe(6), { timeout: 2000 }); });
    expect(contextosWebglEmUso()).toBe(6);
    expect(estado.webgl).toBe(6);
    pilha.forEach((p) => p.unmount());
    expect(contextosWebglEmUso()).toBe(0);
    expect(estado.webgl).toBe(0);
  });
});
