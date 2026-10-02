import { describe, expect, it } from "vitest";
import { CANAIS_HARNESS_TROCA, registrarIpcHarness } from "./harness-manipuladores";
import { criarRegistroIpc, type IpcMainLike } from "./registro";

function montar(troca: Parameters<typeof registrarIpcHarness>[0]["troca"]) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain, autorizar: () => true, log: () => undefined });
  registrarIpcHarness({ registro, harness: {} as never, ...(troca === undefined ? {} : { troca }) });
  return { handlers, chamar: (canal: string, payload: unknown): Promise<any> => Promise.resolve((handlers.get(canal) as (e: unknown, ...a: unknown[]) => unknown)({}, payload)) };
}

describe("IPC harness:* de troca (T-09.20)", () => {
  it("sem o executor ligado, os 3 canais não são registrados", () => {
    expect(CANAIS_HARNESS_TROCA.filter((c) => montar(undefined).handlers.has(c))).toEqual([]);
  });

  it("delega ao executor com o payload validado", async () => {
    const vistos: unknown[] = [];
    const m = montar(() => ({
      trocasListar: (p) => (vistos.push(["listar", p]), { itens: [], proximo: null }),
      trocaDecidir: async (p) => (vistos.push(["decidir", p]), { id: p.troca_id } as never),
      moverPane: async (p) => (vistos.push(["mover", p]), { novo_pane_id: "p2", de: { conta_id: null, provedor: "claude", modelo: null }, para: { conta_id: "c", provedor: "claude", modelo: null } }),
    }));
    expect([...CANAIS_HARNESS_TROCA].every((c) => m.handlers.has(c))).toBe(true);
    expect(await m.chamar("harness:trocas_listar", { limite: 5 })).toEqual({ itens: [], proximo: null });
    await m.chamar("harness:troca_decidir", { troca_id: "trc_0123456789ab", acao: "aceitar" });
    expect((await m.chamar("harness:mover_pane", { pane_id: "pane_0123456789ab", conta_alvo_id: "conta_0123456789ab" })).novo_pane_id).toBe("p2");
    expect(vistos).toEqual([["listar", { limite: 5 }], ["decidir", { troca_id: "trc_0123456789ab", acao: "aceitar" }], ["mover", { pane_id: "pane_0123456789ab", conta_alvo_id: "conta_0123456789ab" }]]);
  });

  it("payload inválido é recusado antes do executor; executor ainda não iniciado dá erro nominal", async () => {
    const m = montar(() => null);
    await expect(m.chamar("harness:mover_pane", { pane_id: "../x" })).rejects.toThrow();
    await expect(m.chamar("harness:trocas_listar", {})).rejects.toThrow(/ainda não iniciou/);
  });
});
