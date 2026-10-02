import { afterEach, describe, expect, it, vi } from "vitest";
import { aoPedirTela } from "./navegacao";
import { aoPedirSquads, pedirSquads, VALIDADE_PEDIDO_SQUADS_MS } from "./squads-acoes";

afterEach(() => vi.useRealTimers());

describe("pedidos de squads (paleta → tela)", () => {
  it("entrega ao ouvinte já montado e leva à tela certa", () => {
    const telas: string[] = [];
    const sair = aoPedirTela((t) => telas.push(t));
    const recebidos: string[] = [];
    const solta = aoPedirSquads((p) => recebidos.push(p), ["abrir-agente", "nova-squad"]);
    pedirSquads("abrir-agente");
    pedirSquads("nova-missao-squad"); // ninguém escuta: fica pendente
    sair();
    solta();
    expect(telas).toEqual(["squads", "missoes"]);
    expect(recebidos).toEqual(["abrir-agente"]);
  });

  it("pedido sem ouvinte espera o primeiro ouvinte interessado (tela lazy) e é entregue uma única vez", () => {
    pedirSquads("importar");
    const a: string[] = [];
    const solta = aoPedirSquads((p) => a.push(p), ["importar"]);
    const b: string[] = [];
    const solta2 = aoPedirSquads((p) => b.push(p), ["importar"]);
    solta();
    solta2();
    expect(a).toEqual(["importar"]);
    expect(b).toEqual([]);
  });

  it("pedido velho (> 4 s) é descartado", () => {
    vi.useFakeTimers();
    pedirSquads("nova-squad");
    vi.advanceTimersByTime(VALIDADE_PEDIDO_SQUADS_MS + 1);
    const a: string[] = [];
    aoPedirSquads((p) => a.push(p), ["nova-squad"])();
    expect(a).toEqual([]);
  });
});
