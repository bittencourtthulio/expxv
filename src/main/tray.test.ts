import { describe, expect, it, vi } from "vitest";
import { criarIconeTray, criarTray, montarItensTray, type InstanciaTray, type ItemTray } from "./tray";
import { criarPreferenciaNotificacoes } from "./preferencia-notificacoes";

function ambiente(inicial: Record<string, unknown> = {}) {
  const m = { ...inicial };
  const notificacoes = criarPreferenciaNotificacoes({ obter: (k) => m[k] ?? null, definir: async (k, v) => { m[k] = v; } });
  const instancia = { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn(), destroy: vi.fn() } satisfies InstanciaTray;
  const Menu = { buildFromTemplate: vi.fn((t: ItemTray[]) => ({ t })) };
  const abrir = vi.fn();
  const sair = vi.fn();
  const icone = { resize: () => icone };
  const tray = criarTray({ Tray: function () { return instancia; } as never, Menu, icone, abrir, sair, notificacoes, nomeApp: "App" });
  return { m, notificacoes, instancia, Menu, abrir, sair, tray };
}

describe("tray", () => {
  it("monta abrir, pausar notificações e sair; clique na bandeja abre", () => {
    const a = ambiente();
    a.tray.instalar();
    const itens = (a.Menu.buildFromTemplate.mock.calls[0] as unknown as [ItemTray[]])[0];
    expect(itens.map((i) => i.label ?? i.type)).toEqual(["Abrir App", "Pausar notificações", "separator", "Sair"]);
    expect(itens[1]?.checked).toBe(false);
    itens[0]?.click?.();
    itens[3]?.click?.();
    expect(a.abrir).toHaveBeenCalled();
    expect(a.sair).toHaveBeenCalled();
    (a.instancia.on.mock.calls[0] as unknown as [string, () => void])[1]();
    expect(a.abrir).toHaveBeenCalledTimes(2);
  });
  it("'pausar notificações' persiste e reaparece marcado", async () => {
    const a = ambiente();
    montarItensTray({ abrir: a.abrir, sair: a.sair, notificacoes: a.notificacoes })[1]?.click?.();
    await Promise.resolve();
    expect(a.m.notificacoes).toBe(false);
    expect(montarItensTray({ abrir: a.abrir, sair: a.sair, notificacoes: a.notificacoes })[1]?.checked).toBe(true);
    montarItensTray({ abrir: a.abrir, sair: a.sair, notificacoes: a.notificacoes })[1]?.click?.();
    await Promise.resolve();
    expect(a.m.notificacoes).toBe(true);
  });
  it("instalar é idempotente e destruir remove a bandeja", () => {
    const a = ambiente();
    a.tray.instalar();
    a.tray.instalar();
    expect(a.instancia.setContextMenu).toHaveBeenCalledTimes(1);
    a.tray.atualizar();
    expect(a.instancia.setContextMenu).toHaveBeenCalledTimes(2);
    a.tray.destruir();
    expect(a.instancia.destroy).toHaveBeenCalledTimes(1);
    a.tray.destruir();
    expect(a.instancia.destroy).toHaveBeenCalledTimes(1);
  });
  it("o ícone vem de build/icone-32.png redimensionado para 16 px", () => {
    const resize = vi.fn(() => ({ resize: vi.fn() }));
    const createFromPath = vi.fn(() => ({ resize }));
    criarIconeTray("/app/dist", { createFromPath } as never);
    expect((createFromPath.mock.calls[0] as unknown as [string])[0]).toMatch(/build[\\/]icone-32\.png$/);
    expect(resize).toHaveBeenCalledWith({ width: 16, height: 16 });
  });
});

describe("caminho do ícone a partir do __dirname do main (dist/main)", () => {
  it("resolve para <raiz>/build/icone-32.png, que existe no repositório", async () => {
    const { existsSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const { ARQUIVO_ICONE_TRAY, criarIconeTray, diretorioBaseDoIcone } = await import("./tray");
    const raiz = resolve(__dirname, "..", "..");
    let pedido = "";
    criarIconeTray(diretorioBaseDoIcone(join(raiz, "dist", "main")), { createFromPath: (c) => { pedido = c; return { resize: () => ({}) as never }; } });
    expect(pedido).toBe(join(raiz, "build", ARQUIVO_ICONE_TRAY));
    expect(existsSync(pedido)).toBe(true);
  });
});
