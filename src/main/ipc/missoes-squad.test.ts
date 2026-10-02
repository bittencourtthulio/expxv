import { describe, expect, it, vi } from "vitest";
import { registrarIpcMissoes } from "./missoes";
import { CanalRecusadoErro, criarRegistroIpc, type IpcMainLike } from "./registro";

const WS = "ws_01J8ZXAMPLE0000000000000A1";
const MIS = "mis_01J8ZXAMPLE0000000000000A1";

function montar(comSquad: boolean) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
  const servico = { listar: vi.fn(), criar: vi.fn(async () => ({ id: MIS })), detalhe: vi.fn(), encerrar: vi.fn(), abortar: vi.fn() };
  const criarComSquad = vi.fn(async () => ({ id: MIS }));
  registrarIpcMissoes({ registro, servico: servico as never, portoes: {} as never, ...(comSquad ? { criarComSquad: criarComSquad as never } : {}) });
  const criar = (p: unknown) => (handlers.get("missoes:criar") as (e: unknown, p: unknown) => Promise<unknown>)({}, p);
  return { criar, servico, criarComSquad };
}
const base = { workspace_id: WS, modo: "agentico", origem: "livre", titulo: "Login", pedido: "fazer o login", clis: {} };

describe("missoes:criar com squad_id (Fase 14, wizard)", () => {
  it("sem squad_id segue direto para o serviço de Missões (MVP intacto)", async () => {
    const m = montar(true);
    await m.criar({ ...base, clis: { piloto: "claude" } });
    expect(m.servico.criar).toHaveBeenCalledTimes(1);
    expect(m.criarComSquad).not.toHaveBeenCalled();
  });

  it("com squad_id (e cadeado) vai pelo fluxo de squads, não pelo serviço", async () => {
    const m = montar(true);
    await m.criar({ ...base, squad_id: "dev-fullstack", squad_cli: "codex" });
    expect(m.criarComSquad).toHaveBeenCalledWith(expect.objectContaining({ squad_id: "dev-fullstack", squad_cli: "codex" }));
    expect(m.servico.criar).not.toHaveBeenCalled();
  });

  it("sem o fluxo de squads ligado, pedido com squad é recusado (nunca cria sem a squad em silêncio)", async () => {
    const m = montar(false);
    await expect(m.criar({ ...base, squad_id: "dev-fullstack" })).rejects.toThrow(/squads/i);
    expect(m.servico.criar).not.toHaveBeenCalled();
  });

  it("validador: modo livre não usa squad; squad_cli exige squad_id; slug e CLI nunca são caminho", async () => {
    const m = montar(true);
    await expect(m.criar({ ...base, modo: "livre", squad_id: "dev-fullstack" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.criar({ ...base, squad_cli: "codex" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.criar({ ...base, squad_id: "../x" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.criar({ ...base, squad_id: "ok", squad_cli: "/bin/sh" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.criar({ ...base, squad_id: "ok", extra: 1 })).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(m.criarComSquad).not.toHaveBeenCalled();
    expect(m.servico.criar).not.toHaveBeenCalled();
  });
});
