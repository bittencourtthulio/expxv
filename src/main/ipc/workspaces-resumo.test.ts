import { describe, expect, it, vi } from "vitest";
import { CANAIS_EVENTO, CANAIS_INVOKE } from "../../compartilhado/ipc";
import { CanalRecusadoErro, criarRegistroIpc, type IpcMainLike } from "./registro";
import { registrarIpcResumoWorkspaces } from "./workspaces-resumo";

const WS = "ws_01J8ZXAMPLE0000000000000A1";
const SES = "sessao_abc123";

function montar(autorizado = true) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: (c) => void handlers.delete(c), removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => autorizado });
  const servico = {
    resumo: vi.fn(async () => ({ versao: 1 as const, gerado_em: 1, itens: [] })),
    ativar: vi.fn(async (a: boolean) => a),
    encerrarAgente: vi.fn(async () => ({ ok: true, motivo: "encerrado" as const })),
    revelar: vi.fn(() => true),
    copiarCaminho: vi.fn(() => true),
    ativo: () => false,
    encerrar: () => undefined,
  };
  registrarIpcResumoWorkspaces({ registro, servico });
  const invocar = (c: string, p?: unknown) => (handlers.get(c) as (e: unknown, p?: unknown) => unknown)({}, p);
  return { registro, servico, invocar };
}

describe("canais do painel de workspaces", () => {
  it("todos os canais workspaces:resumo*, encerrar_agente e revelar do contrato estão registrados; o evento está no contrato", () => {
    const m = montar();
    const esperados = CANAIS_INVOKE.filter((c) => /^workspaces:(resumo|encerrar_agente|revelar|copiar_caminho)/.test(c)).sort();
    expect(esperados).toHaveLength(5);
    expect(m.registro.registrados().sort()).toEqual(esperados);
    expect(CANAIS_EVENTO).toContain("workspaces:resumo_mudou");
  });
  it("resumo não aceita payload; ativar exige booleano", async () => {
    const m = montar();
    expect(await m.invocar("workspaces:resumo")).toMatchObject({ versao: 1 });
    await expect(m.invocar("workspaces:resumo", { x: 1 })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("workspaces:resumo_ativar", { ativo: "sim" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(await m.invocar("workspaces:resumo_ativar", { ativo: true })).toBe(true);
  });
  it("encerrar_agente valida ids e recusa campo extra (cwd, pid, caminho)", async () => {
    const m = montar();
    expect(await m.invocar("workspaces:encerrar_agente", { workspace_id: WS, sessao_id: SES })).toEqual({ ok: true, motivo: "encerrado" });
    expect(m.servico.encerrarAgente).toHaveBeenCalledWith({ workspace_id: WS, sessao_id: SES });
    for (const ruim of [{ workspace_id: WS }, { workspace_id: "../x", sessao_id: SES }, { workspace_id: WS, sessao_id: "1234; rm -rf" }, { workspace_id: WS, sessao_id: SES, pid: 1 }, { workspace_id: WS, sessao_id: SES, cwd: "/" }]) {
      await expect(m.invocar("workspaces:encerrar_agente", ruim)).rejects.toBeInstanceOf(CanalRecusadoErro);
    }
    expect(m.servico.encerrarAgente).toHaveBeenCalledTimes(1);
  });
  it("revelar só recebe id de workspace", async () => {
    const m = montar();
    expect(await m.invocar("workspaces:revelar", { workspace_id: WS })).toBe(true);
    await expect(m.invocar("workspaces:revelar", { caminho: "/etc" })).rejects.toBeInstanceOf(CanalRecusadoErro);
  });
  it("copiar_caminho só recebe id de workspace e delega ao serviço", async () => {
    const m = montar();
    expect(await m.invocar("workspaces:copiar_caminho", { workspace_id: WS })).toBe(true);
    expect(m.servico.copiarCaminho).toHaveBeenCalledWith(WS);
    await expect(m.invocar("workspaces:copiar_caminho", { workspace_id: WS, texto: "x" })).rejects.toBeInstanceOf(CanalRecusadoErro);
  });
  it("remetente não autorizado é recusado antes do serviço", async () => {
    const m = montar(false);
    await expect(m.invocar("workspaces:encerrar_agente", { workspace_id: WS, sessao_id: SES })).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(m.servico.encerrarAgente).not.toHaveBeenCalled();
  });
});
