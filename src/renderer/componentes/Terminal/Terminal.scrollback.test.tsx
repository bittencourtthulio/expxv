// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ instancias: [] as Array<{ options: { scrollback?: number; fontSize?: number } }> }));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: { scrollback?: number; fontSize?: number; theme?: unknown };
    cols = 80;
    rows = 24;
    buffer = { active: { viewportY: 0, length: 0, getLine: () => undefined } };
    dispose() {}
    constructor(opcoes: { scrollback?: number; fontSize?: number; theme?: unknown }) { this.options = { ...opcoes }; estado.instancias.push(this); }
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    open() {}
    focus() {}
    refresh() {}
    paste() {}
    onData() { return { dispose() {} }; }
    write() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { proposeDimensions() { return { cols: 100, rows: 30 }; } fit() {} } }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class { findNext() { return true; } findPrevious() { return true; } clearDecorations() {} } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));

import { criarStoreConfig } from "../../estado/config";
import { criarArmazem } from "./armazem";
import { Terminal } from "./Terminal";

const api = { escrever: vi.fn(), redimensionar: vi.fn(), confirmarConsumo: vi.fn().mockResolvedValue(true) };
beforeEach(() => { estado.instancias.length = 0; });

function storeCom(valor: unknown) {
  const cfg = { ler: vi.fn(async (chave: string) => (chave === "terminal_scrollback" ? valor : undefined)), gravar: vi.fn().mockResolvedValue(undefined) };
  return { cfg, store: criarStoreConfig({ api: () => cfg as never, raiz: document.createElement("div") }) };
}

describe("Terminal: scrollback vem da config (terminal_scrollback)", () => {
  it("sem config lida usa o padrão 5 000 (não os 8 000 antigos)", () => {
    const { store } = storeCom(undefined);
    render(<Terminal sessaoId="s1" ativo tema="escuro" webgl={false} api={api} armazem={criarArmazem()} config={store} />);
    expect(estado.instancias[0]!.options.scrollback).toBe(5_000);
  });

  it("valor salvo chega ao xterm e a mudança é aplicada SEM recriar o terminal", async () => {
    const { store } = storeCom(20_000);
    await store.iniciar();
    render(<Terminal sessaoId="s1" ativo tema="escuro" webgl={false} api={api} armazem={criarArmazem()} config={store} />);
    expect(estado.instancias).toHaveLength(1);
    expect(estado.instancias[0]!.options.scrollback).toBe(20_000);
    await act(async () => { await store.definir("scrollback", 1_000); });
    expect(estado.instancias).toHaveLength(1);
    expect(estado.instancias[0]!.options.scrollback).toBe(1_000);
  });

  it("fonte do terminal compacta (≤ 12 px)", () => {
    const { store } = storeCom(undefined);
    render(<Terminal sessaoId="s1" ativo tema="escuro" webgl={false} api={api} armazem={criarArmazem()} config={store} />);
    expect(estado.instancias[0]!.options.fontSize).toBeLessThanOrEqual(12);
  });
});
