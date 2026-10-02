// Canais `sistema:*` (D-530…): contrato fechado, validadores estritos, manipuladores que só delegam. Sem Electron.
import { describe, expect, it, vi } from "vitest";
import { CANAIS_EVENTO, CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import type { ServicoSistema } from "../../nucleo/sistema/servico";
import { criarRegistroIpc, type IpcMainLike } from "./registro";
import { VALIDADORES_SISTEMA, registrarIpcSistema } from "./sistema";

const canais = CANAIS_INVOKE.filter((c) => c.startsWith("sistema:"));

function montar() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain, autorizar: () => true });
  const servico = { definirAssinatura: vi.fn(), detalhe: vi.fn(async (aberto: boolean) => (aberto ? ({ cpu_total: 1 } as never) : null)) } as unknown as ServicoSistema;
  const criar = vi.fn(async () => servico);
  registrarIpcSistema({ registro, servico: criar });
  const chamar = (canal: string, payload: unknown): Promise<unknown> => Promise.resolve((handlers.get(canal) as (e: unknown, p: unknown) => unknown)({}, payload));
  return { handlers, chamar, servico, criar };
}

describe("canais sistema:*", () => {
  it("contrato: 2 canais de invocação e 1 evento; nenhum sensível; todos com validador e manipulador", () => {
    expect(canais.sort()).toEqual(["sistema:amostra_assinar", "sistema:detalhe"]);
    expect(Object.keys(VALIDADORES_SISTEMA).sort()).toEqual(canais);
    expect(CANAIS_EVENTO).toContain("sistema:amostra");
    for (const c of canais) expect(CANAIS_SENSIVEIS as readonly string[]).not.toContain(c);
    expect([...montar().handlers.keys()].sort()).toEqual(canais);
  });

  it("registrar não cria o serviço (nada no boot); a primeira chamada cria", async () => {
    const m = montar();
    expect(m.criar).not.toHaveBeenCalled();
    await m.chamar("sistema:amostra_assinar", { ativo: true });
    expect(m.criar).toHaveBeenCalledTimes(1);
    expect(m.servico.definirAssinatura).toHaveBeenCalledWith(true);
  });

  it("detalhe só repassa o booleano; fechado devolve nulo", async () => {
    const m = montar();
    expect(await m.chamar("sistema:detalhe", { aberto: true })).toEqual({ cpu_total: 1 });
    expect(await m.chamar("sistema:detalhe", { aberto: false })).toBeNull();
  });

  it("validadores recusam tipo errado, campo ausente, sem payload e lixo", () => {
    for (const c of canais) {
      const v = VALIDADORES_SISTEMA[c as keyof typeof VALIDADORES_SISTEMA];
      for (const ruim of [undefined, null, 1, "x", [], {}, { ativo: 1, aberto: "sim" }]) expect(v(ruim).ok).toBe(false);
    }
    expect(VALIDADORES_SISTEMA["sistema:amostra_assinar"]({ ativo: true }).ok).toBe(true);
    expect(VALIDADORES_SISTEMA["sistema:detalhe"]({ aberto: false }).ok).toBe(true);
  });

  it("campo extra é recusado (o renderer não escolhe pid, comando nem nada além do booleano)", () => {
    expect(VALIDADORES_SISTEMA["sistema:detalhe"]({ aberto: true, pid: 1, comando: "rm -rf" }).ok).toBe(false);
  });
});
