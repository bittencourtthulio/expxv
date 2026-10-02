import { describe, expect, it, vi } from "vitest";
import type { AcaoMenu } from "../../compartilhado/ipc";
import { ligarMenuNativo } from "./menu";
import { aoPedirPaleta, aoPedirTela } from "./navegacao";

function montar() {
  let enviar: (e: { acao: AcaoMenu }) => void = () => undefined;
  const cancelarApi = vi.fn();
  const api = { assinar: vi.fn((cb: typeof enviar) => { enviar = cb; return cancelarApi; }) };
  const d = { abrirProjeto: vi.fn(), adicionarWorkspace: vi.fn(), alternarTema: vi.fn() };
  const cancelar = ligarMenuNativo({ api: () => api as never, ...d });
  return { api, d, cancelar, cancelarApi, emitir: (acao: AcaoMenu) => enviar({ acao }) };
}

describe("assinante do menu nativo", () => {
  it("assina uma única vez e executa cada ação", () => {
    const m = montar();
    const telas: string[] = [];
    const paleta = vi.fn();
    const c1 = aoPedirTela((t) => telas.push(t));
    const c2 = aoPedirPaleta(paleta);
    expect(m.api.assinar).toHaveBeenCalledTimes(1);
    m.emitir("abrir-projeto");
    m.emitir("tema");
    m.emitir("paleta");
    m.emitir("sobre");
    expect(m.d.abrirProjeto).toHaveBeenCalledTimes(1);
    expect(m.d.alternarTema).toHaveBeenCalledTimes(1);
    expect(paleta).toHaveBeenCalledTimes(1);
    expect(telas).toEqual(["config"]);
    c1(); c2();
  });
  it("Abrir pasta (⌘O) vai DIRETO ao diálogo; Adicionar workspace (⌘⇧O) abre o modal — são ações distintas", () => {
    const m = montar();
    m.emitir("adicionar-workspace");
    expect(m.d.adicionarWorkspace).toHaveBeenCalledTimes(1);
    expect(m.d.abrirProjeto).not.toHaveBeenCalled();
    m.emitir("abrir-projeto");
    expect(m.d.abrirProjeto).toHaveBeenCalledTimes(1);
    expect(m.d.adicionarWorkspace).toHaveBeenCalledTimes(1);
  });
  it("cancelar solta a assinatura; sem ponte não faz nada", () => {
    const m = montar();
    m.cancelar();
    expect(m.cancelarApi).toHaveBeenCalled();
    expect(() => ligarMenuNativo({ api: () => undefined, abrirProjeto: vi.fn(), alternarTema: vi.fn() })()).not.toThrow();
  });
});
