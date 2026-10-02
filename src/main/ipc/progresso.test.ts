// Canais `progresso:*` (D-660…): contrato fechado (paridade com a lista de canais), validadores estritos e saneamento de erro. Sem Electron.
import { describe, expect, it } from "vitest";
import { CANAIS_EVENTO, CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import type { ServicoProgresso } from "../progresso";
import { VALIDADORES_PROGRESSO, registrarIpcProgresso, vIdProgresso } from "./progresso";
import { criarRegistroIpc, type IpcMainLike } from "./registro";

const canais = CANAIS_INVOKE.filter((c) => c.startsWith("progresso:"));

function montar(falha = false) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain, autorizar: () => true });
  const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
  const servico: ServicoProgresso = {
    estado: async () => { chamadas.push({ metodo: "estado", args: [] }); return { progressos: [] }; },
    dispensar: (id) => void chamadas.push({ metodo: "dispensar", args: [id] }),
    fixar: (id, f) => void chamadas.push({ metodo: "fixar", args: [id, f] }),
    aoSkillDetectada: () => undefined,
    ativo: () => false,
    encerrar: () => undefined,
  };
  registrarIpcProgresso({ registro, servico: async () => { if (falha) throw new Error("/Users/segredo/caminho"); return servico; } });
  const chamar = (canal: string, ...payload: unknown[]): Promise<unknown> => Promise.resolve((handlers.get(canal) as (e: unknown, ...p: unknown[]) => unknown)({}, ...payload));
  return { handlers, chamar, chamadas };
}

describe("canais progresso:*", () => {
  it("contrato: 3 canais de invocação e 1 evento; nenhum é sensível; todos têm validador e manipulador", () => {
    expect(canais.sort()).toEqual(["progresso:dispensar", "progresso:estado", "progresso:fixar"]);
    expect(Object.keys(VALIDADORES_PROGRESSO).sort()).toEqual(canais);
    expect(CANAIS_EVENTO).toContain("progresso:mudou");
    for (const c of canais) expect(CANAIS_SENSIVEIS as readonly string[]).not.toContain(c);
    expect([...montar().handlers.keys()].sort()).toEqual(canais);
  });

  it("aceita entradas válidas e delega ao serviço", async () => {
    const m = montar();
    await m.chamar("progresso:estado");
    await m.chamar("progresso:dispensar", { id: "pl:mpl_AAAA1111" });
    await m.chamar("progresso:fixar", { id: "sk:runx:pane_1", fixado: true });
    expect(m.chamadas).toEqual([{ metodo: "estado", args: [] }, { metodo: "dispensar", args: ["pl:mpl_AAAA1111"] }, { metodo: "fixar", args: ["sk:runx:pane_1", true] }]);
  });

  it.each<[string, unknown]>([
    ["progresso:dispensar", {}],
    ["progresso:dispensar", { id: "x" }],
    ["progresso:dispensar", { id: "pl:ok", extra: 1 }],
    ["progresso:dispensar", { id: "pl:../../etc/passwd" }],
    ["progresso:dispensar", { id: "pl:" + "a".repeat(200) }],
    ["progresso:dispensar", { id: "zz:abc" }],
    ["progresso:dispensar", { id: "pl:ok", cwd: "/tmp" }],
    ["progresso:fixar", { id: "pl:ok" }],
    ["progresso:fixar", { id: "pl:ok", fixado: "sim" }],
    ["progresso:fixar", { id: "pl:ok", fixado: true, rotulo: "x" }],
  ])("recusa %s %j", async (canal, payload) => {
    const m = montar();
    await expect(m.chamar(canal, payload)).rejects.toThrow();
    expect(m.chamadas).toEqual([]);
  });

  it("estado não aceita payload", async () => {
    await expect(montar().chamar("progresso:estado", { x: 1 })).rejects.toThrow();
  });

  it("falha do serviço vira texto genérico, sem caminho da máquina", async () => {
    const m = montar(true);
    for (const [canal, p] of [["progresso:estado", undefined], ["progresso:dispensar", { id: "pl:ok1" }], ["progresso:fixar", { id: "pl:ok1", fixado: false }]] as const) {
      const e = await (p === undefined ? m.chamar(canal) : m.chamar(canal, p)).catch((x: Error) => x);
      expect((e as Error).message).not.toContain("/Users");
      expect((e as Error).message).toMatch(/progresso/);
    }
  });

  it("vIdProgresso aceita os três formatos de id", () => {
    for (const id of ["pl:mpl_AAAA1111", "sx:OC-2026-0142-frete", "sk:runx:pane_ABC.1"]) expect(vIdProgresso(id).ok).toBe(true);
  });
});
