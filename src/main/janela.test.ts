import { describe, expect, it, vi } from "vitest";
import { COR_FUNDO_JANELA } from "../compartilhado/tema";
import { caminhoDoPreload, criarJanela, DIMENSOES, opcoesDaJanela, webPreferencesSeguras } from "./janela";

describe("webPreferencesSeguras", () => {
  it("liga contextIsolation e sandbox e desliga nodeIntegration", () => {
    const p = webPreferencesSeguras("/x/preload.js");
    expect(p).toMatchObject({
      preload: "/x/preload.js",
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });
  });
});

describe("opcoesDaJanela", () => {
  it("nasce oculta, com mínimo de 720 px e fundo do tema", () => {
    const escuro = opcoesDaJanela("/p.js", "escuro");
    expect(escuro.show).toBe(false);
    expect(escuro.minWidth).toBe(DIMENSOES.larguraMinima);
    expect(escuro.backgroundColor).toBe(COR_FUNDO_JANELA.escuro);
    expect(opcoesDaJanela("/p.js", "claro").backgroundColor).toBe(COR_FUNDO_JANELA.claro);
  });

  it("os dois fundos são diferentes e válidos", () => {
    expect(COR_FUNDO_JANELA.escuro).toMatch(/^#[0-9a-f]{6}$/);
    expect(COR_FUNDO_JANELA.claro).toMatch(/^#[0-9a-f]{6}$/);
    expect(COR_FUNDO_JANELA.escuro).not.toBe(COR_FUNDO_JANELA.claro);
  });
});

describe("criarJanela", () => {
  it("carrega a URL e só mostra em ready-to-show", () => {
    const ouvintes = new Map<string, () => void>();
    const show = vi.fn();
    const loadURL = vi.fn();
    class FalsaJanela {
      constructor(readonly opcoes: unknown) {}
      loadURL = loadURL;
      on = vi.fn();
      once = (evento: string, cb: () => void): void => {
        ouvintes.set(evento, cb);
      };
      show = show;
    }
    const aoMostrar = vi.fn();
    criarJanela({ url: "x://app/index.html", preload: "/p.js", tema: "escuro", BrowserWindow: FalsaJanela as never, aoMostrar });
    expect(loadURL).toHaveBeenCalledWith("x://app/index.html");
    expect(show).not.toHaveBeenCalled();
    ouvintes.get("ready-to-show")?.();
    expect(show).toHaveBeenCalledTimes(1);
    expect(aoMostrar).toHaveBeenCalledTimes(1);
  });
});

describe("caminhoDoPreload", () => {
  it("aponta para dist/preload/preload.js a partir de dist/main", () => {
    expect(caminhoDoPreload("/app/dist/main").replace(/\\/g, "/")).toBe("/app/dist/preload/preload.js");
  });
});
