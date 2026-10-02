import { describe, expect, it, vi } from "vitest";
import type { RespostaLimites } from "../../compartilhado/limites";
import { ID_ADAPTADOR_MANUAL, registrarIpcLimites } from "./limites";
import { CanalRecusadoErro, criarRegistroIpc, type IpcMainLike } from "./registro";

const C = "conta_01J8ZXAMPLE00000000000A1";
const T1 = "2026-10-02T00:00:00.000Z";
const VAZIA: RespostaLimites = { contas: [], geral: { pior: null, folga_media_pct: null, cobertura: { com_dado: 0, total: 0 }, em_alerta: 0, esgotadas: 0 } };

function montar(comHistorico = false) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
  const uso = { account_id: C } as never;
  const servico = { snapshot: vi.fn(() => VAZIA), atualizar: vi.fn(async () => VAZIA), usoDe: vi.fn(() => uso), recarregarFonte: vi.fn(async () => uso) };
  const manual = { definir: vi.fn(() => ({})), limpar: vi.fn(() => 1) };
  const historico = { historico: vi.fn(() => []), previsao: vi.fn(() => []), eficiencia: vi.fn(() => []), alertas: vi.fn(() => []) };
  registrarIpcLimites({ registro, servico, manual, ...(comHistorico ? { historico } : {}) });
  const chamar = (canal: string, payload: unknown) => (handlers.get(canal) as (e: unknown, p: unknown) => unknown)({}, payload);
  return { servico, manual, historico, chamar, registro };
}

describe("manipuladores limites:*", () => {
  it("snapshot e atualizar repassam o filtro; saída é a do serviço", async () => {
    const m = montar();
    expect(await m.chamar("limites:snapshot", { conta_ids: [C] })).toBe(VAZIA);
    expect(m.servico.snapshot).toHaveBeenCalledWith([C]);
    await m.chamar("limites:snapshot", {});
    expect(m.servico.snapshot).toHaveBeenLastCalledWith(undefined);
    await m.chamar("limites:atualizar", { conta_id: C });
    expect(m.servico.atualizar).toHaveBeenCalledWith(C);
  });

  it("manual_definir grava e relê só a fonte manual; manual_limpar idem", async () => {
    const m = montar();
    await m.chamar("limites:manual_definir", { conta_id: C, janela: "weekly", usado_pct: 40, reinicia_em: T1 });
    expect(m.manual.definir).toHaveBeenCalledWith(C, "weekly", 40, T1);
    expect(m.servico.recarregarFonte).toHaveBeenCalledWith(C, ID_ADAPTADOR_MANUAL);
    await m.chamar("limites:manual_limpar", { conta_id: C });
    expect(m.manual.limpar).toHaveBeenCalledWith(C, undefined);
    await m.chamar("limites:manual_limpar", { conta_id: C, janela: "five_hour" });
    expect(m.manual.limpar).toHaveBeenLastCalledWith(C, "five_hour");
  });

  it("payload inválido é recusado antes do manipulador", async () => {
    const m = montar();
    await expect(Promise.resolve(m.chamar("limites:manual_definir", { conta_id: C, janela: "weekly", usado_pct: 140, reinicia_em: null }))).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(Promise.resolve(m.chamar("limites:snapshot", { conta_ids: ["/etc/passwd"] }))).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(m.manual.definir).not.toHaveBeenCalled();
  });

  it("histórico/previsão/eficiência/alertas só existem quando a T-09.09 injeta o serviço", async () => {
    const sem = montar(false);
    expect(sem.registro.registrados().sort()).toEqual(["limites:atualizar", "limites:manual_definir", "limites:manual_limpar", "limites:snapshot"]);
    const com = montar(true);
    expect(com.registro.registrados()).toHaveLength(8);
    await com.chamar("limites:eficiencia", { semanas: 4 });
    expect(com.historico.eficiencia).toHaveBeenCalledWith(4, undefined);
    await com.chamar("limites:previsao", { conta_id: C });
    expect(com.historico.previsao).toHaveBeenCalledWith(C);
  });
});
