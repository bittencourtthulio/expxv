// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { instalar, remover } from "../../a11y/ade-falso";
import { pedirCaptura } from "../../estado/captura-acoes";
import { HostCaptura } from "./Host";

afterEach(() => { cleanup(); remover(); });

describe("HostCaptura", () => {
  it("não renderiza nada (e não carrega o fluxo) até o primeiro pedido", () => {
    const { container } = render(<HostCaptura />);
    expect(container.innerHTML).toBe("");
  });

  it("o primeiro pedido carrega o fluxo lazy e o executa", async () => {
    instalar();
    const captura = { estado: vi.fn(async () => ({ tela: "concedida", janela_app: true, plataforma: "mac", aviso_visto: true, fps_padrao: 2, atalhos_globais: false, atalho_regiao: "x", atalho_quadros: "y", gravando_quadros: false, atalho_erro: null })), listar: vi.fn(async () => ({ itens: [], proximo: null })), assinar: vi.fn(() => () => undefined) };
    (globalThis as unknown as { ade: Record<string, unknown> }).ade = { ...((globalThis as unknown as { ade: object }).ade), captura };
    render(<HostCaptura />);
    await act(async () => { pedirCaptura("galeria"); });
    await screen.findByRole("complementary", { name: "Capturas" }, { timeout: 4_000 });
    expect(captura.listar).toHaveBeenCalled();
  });

  it("atalhos dentro do app: ⌘⇧5 pede região e ⌘⇧6 pede quadros (Ctrl+Shift fora do macOS)", async () => {
    instalar();
    const pedidos: string[] = [];
    const { aoPedirCaptura } = await import("../../estado/captura-acoes");
    const off = aoPedirCaptura((p) => pedidos.push(p));
    (globalThis as unknown as { ade: Record<string, unknown> }).ade = { ...((globalThis as unknown as { ade: object }).ade), captura: { assinar: () => () => undefined, estado: async () => ({}) } };
    render(<HostCaptura />);
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const mod = mac ? { metaKey: true } : { ctrlKey: true };
    fireEvent.keyDown(document, { code: "Digit5", shiftKey: true, ...mod });
    fireEvent.keyDown(document, { code: "Digit6", shiftKey: true, ...mod });
    fireEvent.keyDown(document, { code: "Digit5", shiftKey: true, ...mod, repeat: true });
    fireEvent.keyDown(document, { code: "Digit5", shiftKey: true });
    off();
    expect(pedidos.slice(0, 2)).toEqual(["regiao-tela", "quadros-tela"]);
    expect(pedidos).toHaveLength(2);
  });
});
