import { describe, expect, it, vi } from "vitest";
import { criarMenu, montarTemplateMenu, type EventoMenu, type ItemTemplate } from "./menu";

const rotulos = (t: ItemTemplate[]) => t.map((m) => m.label);
function achar(t: ItemTemplate[], label: string): ItemTemplate | undefined {
  for (const m of t) {
    if (m.label === label) return m;
    const d = m.submenu ? achar(m.submenu, label) : undefined;
    if (d) return d;
  }
  return undefined;
}

describe("menu nativo por plataforma", () => {
  it("mac: tem o menu do app na frente e atalhos Cmd", () => {
    const t = montarTemplateMenu("darwin", () => {}, "App");
    expect(rotulos(t)).toEqual(["App", "Arquivo", "Editar", "Visualização", "Janela", "Ajuda"]);
    expect(achar(t, "Paleta de comandos…")?.accelerator).toBe("Cmd+K");
    expect(achar(t, "Abrir projeto…")?.accelerator).toBe("Cmd+O");
    expect(achar(t, "Alternar tema")?.accelerator).toBe("Cmd+Shift+L");
    expect(t[0]?.submenu?.some((i) => i.role === "quit")).toBe(true);
  });
  it("Windows/Linux: sem menu do app, Sair em Arquivo e atalhos Ctrl+Shift (nunca Ctrl+letra)", () => {
    for (const p of ["win32", "linux"]) {
      const t = montarTemplateMenu(p, () => {}, "App");
      expect(rotulos(t)).toEqual(["Arquivo", "Editar", "Visualização", "Janela", "Ajuda"]);
      expect(achar(t, "Sair")?.role).toBe("quit");
      expect(achar(t, "Paleta de comandos…")?.accelerator).toBe("Ctrl+Shift+P");
      const todos = JSON.stringify(t);
      expect(todos).not.toMatch(/"accelerator":"Ctrl\+[A-Z]"/);
      expect(achar(t, "Sobre App")).toBeDefined();
    }
  });
  it("as ações emitem eventos pelo callback injetado; atalhos do renderer não registram em duplicidade", () => {
    const emitir = vi.fn<(e: EventoMenu) => void>();
    const t = montarTemplateMenu("darwin", emitir, "App");
    achar(t, "Abrir projeto…")?.click?.();
    achar(t, "Paleta de comandos…")?.click?.();
    achar(t, "Escuro")?.click?.();
    expect(emitir.mock.calls.map((c) => c[0])).toEqual([{ tipo: "abrir-projeto" }, { tipo: "paleta" }, { tipo: "tema", valor: "escuro" }]);
    expect(achar(t, "Paleta de comandos…")?.registerAccelerator).toBe(false);
  });
  it("criarMenu instala e destruir limpa o menu do aplicativo", () => {
    const Menu = { buildFromTemplate: vi.fn((t: ItemTemplate[]) => ({ t })), setApplicationMenu: vi.fn() };
    const m = criarMenu({ plataforma: "linux", Menu, emitir: () => {} });
    m.instalar();
    expect(Menu.setApplicationMenu).toHaveBeenCalledWith(expect.objectContaining({ t: expect.any(Array) }));
    m.destruir();
    expect(Menu.setApplicationMenu).toHaveBeenLastCalledWith(null);
  });
});
