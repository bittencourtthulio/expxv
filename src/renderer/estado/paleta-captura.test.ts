import { afterEach, describe, expect, it, vi } from "vitest";
import { aoPedirCaptura } from "./captura-acoes";
import { montarComandos, type AcoesPaleta, type ContextoPaleta } from "./paleta";

const acoes = (): AcoesPaleta => ({ navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn() });
const ctx = (mac = true): ContextoPaleta => ({ mac, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "escuro", acoes: acoes() });

let desligar: (() => void) | null = null;
afterEach(() => desligar?.());

describe("paleta: captura e voz", () => {
  it("lista as ações com atalho por plataforma, sem tocar nos atalhos nativos do macOS", () => {
    const cs = montarComandos(ctx()).filter((c) => c.grupo === "Voz e captura");
    expect(cs.map((c) => c.id)).toEqual(["captura:regiao", "captura:regiao-janela", "captura:janela", "captura:quadros", "captura:quadros-janela", "captura:quadros-parar", "captura:galeria", "voz:configurar"]);
    expect(cs.find((c) => c.id === "captura:regiao")?.atalho).toBe("⌘⇧5");
    expect(montarComandos(ctx(false)).find((c) => c.id === "captura:quadros")?.atalho).toBe("Ctrl+Shift+6");
  });

  it("cada comando pede a captura certa pelo barramento", () => {
    const pedidos: string[] = [];
    desligar = aoPedirCaptura((p) => pedidos.push(p));
    const por = new Map(montarComandos(ctx()).map((c) => [c.id, c]));
    for (const id of ["captura:regiao", "captura:regiao-janela", "captura:janela", "captura:quadros", "captura:quadros-janela", "captura:quadros-parar", "captura:galeria"]) por.get(id)!.executar();
    expect(pedidos).toEqual(["regiao-tela", "regiao-janela", "janela", "quadros-tela", "quadros-janela", "quadros-parar", "galeria"]);
  });

  it("pedido sem ouvinte espera pouco pelo primeiro (tela lazy) e expira", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { pedirCaptura, VALIDADE_PEDIDO_CAPTURA_MS } = await import("./captura-acoes");
      pedirCaptura("galeria");
      const recebidos: string[] = [];
      desligar = aoPedirCaptura((p) => recebidos.push(p));
      expect(recebidos).toEqual(["galeria"]);
      desligar();
      pedirCaptura("janela");
      vi.setSystemTime(Date.now() + VALIDADE_PEDIDO_CAPTURA_MS + 1);
      desligar = aoPedirCaptura((p) => recebidos.push(p));
      expect(recebidos).toEqual(["galeria"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
