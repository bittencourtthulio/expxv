import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CANAIS_ENVIO, CANAIS_EVENTO, CANAIS_INVOKE, CHAVES_API_ADE } from "../compartilhado/ipc";

const FONTE = readFileSync(resolve(__dirname, "preload.ts"), "utf8");

describe("preload (formato travado)", () => {
  it("usa só `electron` em runtime (sandbox): nenhum require/import relativo de valor", () => {
    const imports = [...FONTE.matchAll(/^import\s+(?!type)[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports).toEqual(["electron"]);
  });

  it("não usa sendSync (bloquearia a abertura)", () => {
    expect(FONTE).not.toContain("sendSync");
  });

  it("todo canal citado no preload existe no contrato e todo canal do contrato é usado", () => {
    const citados = new Set([...FONTE.matchAll(/"((?:app|terminais|workspaces|provedores|missoes|metodo|limites|harness|cofre|squads|agentes):[a-z_]+)"/g)].map((m) => m[1]));
    const contrato = new Set<string>([...CANAIS_INVOKE, ...CANAIS_ENVIO, ...CANAIS_EVENTO]);
    expect([...citados].sort()).toEqual([...contrato].sort());
  });

  it("expõe exatamente as chaves enumeradas como window.ade", async () => {
    const exposto: Record<string, unknown> = {};
    vi.doMock("electron", () => ({
      contextBridge: { exposeInMainWorld: (nome: string, api: unknown) => void (exposto[nome] = api) },
      ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
    }));
    vi.resetModules();
    await import("./preload");
    expect(Object.keys(exposto)).toEqual(["ade"]);
    expect(Object.keys(exposto["ade"] as object).sort()).toEqual([...CHAVES_API_ADE].sort());
    vi.doUnmock("electron");
  });
});
