import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarPreferencias } from "./preferencias";
import { criarPreferenciaNotificacoes } from "./preferencia-notificacoes";

function memoria(inicial: Record<string, unknown> = {}) {
  const m = { ...inicial };
  return { obter: (k: string) => m[k] ?? null, definir: async (k: string, v: unknown) => { m[k] = v; } };
}

describe("preferência de notificações", () => {
  it("padrão é ligado; 'desligado' e false desligam", () => {
    expect(criarPreferenciaNotificacoes(memoria()).ativo()).toBe(true);
    expect(criarPreferenciaNotificacoes(memoria({ notificacoes: "desligado" })).ativo()).toBe(false);
    expect(criarPreferenciaNotificacoes(memoria({ notificacoes: false })).ativo()).toBe(false);
    expect(criarPreferenciaNotificacoes(memoria({ notificacoes: "lixo" })).ativo()).toBe(true);
  });
  it("grava booleano (o mesmo valor que a tela de Configurações lê e escreve)", async () => {
    const gravado: Record<string, unknown> = {};
    const p = criarPreferenciaNotificacoes({ obter: (k) => gravado[k] ?? null, definir: async (k, v) => { gravado[k] = v; } });
    await p.definir(false);
    expect(gravado["notificacoes"]).toBe(false);
    await p.definir(true);
    expect(gravado["notificacoes"]).toBe(true);
  });
  it("alternar persiste no arquivo de preferências e sobrevive a um novo boot", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "pref-notif-"));
    const a = criarPreferenciaNotificacoes(criarPreferencias(pasta));
    expect(await a.alternar()).toBe(false);
    expect(criarPreferenciaNotificacoes(criarPreferencias(pasta)).ativo()).toBe(false);
    expect(await a.alternar()).toBe(true);
    expect(criarPreferenciaNotificacoes(criarPreferencias(pasta)).ativo()).toBe(true);
  });
});
