import { describe, expect, it, vi } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import { CanalRecusadoErro, criarRegistroIpc, type IpcMainLike } from "./registro";
import { registrarIpcVcs } from "./vcs-manipuladores";

const WS = "ws_01J8ZXAMPLE0000000000000A1";
const MIS = "mis_01J8ZXAMPLE0000000000000A1";
const A = { workspace_id: WS, mission_id: null };

function montar(autorizado = true) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => autorizado });
  const vcs = {
    estado: vi.fn(async () => ({}) as never),
    observar: vi.fn(async () => ({}) as never),
    diff: vi.fn(async () => ({}) as never),
    familia: vi.fn(async () => ({ ok: true })),
    missao: vi.fn(async () => ({})),
  };
  registrarIpcVcs({ registro, vcs });
  const invocar = (canal: string, payload?: unknown) => (handlers.get(canal) as (e: unknown, p?: unknown) => unknown)({}, payload);
  return { registro, vcs, invocar };
}

const VALIDOS: Record<string, unknown> = {
  "vcs:estado": { ...A, ignorados: false },
  "vcs:observar": { ...A, ativo: true },
  "vcs:diff": { ...A, caminho: null, staged: false, base: null, palavra: false, contexto: null, nao_rastreado: false, limite_bytes: null },
  "vcs:estagio": { ...A, op: "estagiar", caminhos: ["a.ts"] },
  "vcs:commit": { ...A, op: "modelo" },
  "vcs:ramos": { ...A, op: "padrao" },
  "vcs:stash": { ...A, op: "listar" },
  "vcs:historico": { ...A, op: "detalhe", rev: "HEAD" },
  "vcs:remoto": { ...A, op: "listar" },
  "vcs:operacao": { ...A, op: "estado" },
  "vcs:conflitos": { ...A, op: "listar" },
  "vcs:svn": { ...A, op: "info" },
  "vcs:forge": { ...A, op: "estado" },
  "vcs:missao": { mission_id: MIS, op: "resumo" },
};

describe("registrarIpcVcs", () => {
  it("registra exatamente os 14 canais vcs:* do contrato", () => {
    const { registro } = montar();
    expect(registro.registrados().filter((c) => c.startsWith("vcs:") && !c.startsWith("vcs:publicar_"))).toEqual(CANAIS_INVOKE.filter((c) => c.startsWith("vcs:") && !c.startsWith("vcs:publicar_")).sort());
    expect(Object.keys(VALIDOS).sort()).toEqual(registro.registrados());
  });

  it("cada canal aceita o payload válido e delega", async () => {
    for (const [canal, payload] of Object.entries(VALIDOS)) {
      const m = montar();
      await expect(m.invocar(canal, payload)).resolves.not.toThrow();
      const chamadas = Object.values(m.vcs).reduce((s, f) => s + f.mock.calls.length, 0);
      expect(chamadas, canal).toBe(1);
    }
  });

  it("payload inválido e remetente indevido são recusados antes do núcleo", async () => {
    const m = montar();
    await expect(m.invocar("vcs:estagio", { ...A, op: "estagiar", caminhos: ["../x"] })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("vcs:ramos", { ...A, op: "apagar", nome: "x" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("vcs:estado", { ...A, ignorados: false, cwd: "/" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    const indevido = montar(false);
    for (const [canal, payload] of Object.entries(VALIDOS)) await expect(indevido.invocar(canal, payload), canal).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(Object.values(m.vcs).reduce((s, f) => s + f.mock.calls.length, 0)).toBe(0);
    expect(Object.values(indevido.vcs).reduce((s, f) => s + f.mock.calls.length, 0)).toBe(0);
  });
});
