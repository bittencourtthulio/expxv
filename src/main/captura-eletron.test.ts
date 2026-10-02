import { describe, expect, it, vi } from "vitest";
import { criarCodificadorEletron, criarFonteEletron, criarPortaSistemaEletron, criarPreviaEletron, criarTeclaGlobalEletron, type ImagemNativa, type ModuloElectron } from "./captura-eletron";

function imagem(l: number, a: number, marca = 7): ImagemNativa & { resized?: { width: number; height: number } } {
  const dados = Buffer.alloc(l * a * 4, marca);
  const img: ImagemNativa & { resized?: { width: number; height: number } } = {
    getSize: () => ({ width: l, height: a }),
    toBitmap: () => dados,
    toPNG: () => Buffer.from([0x89, 0x50]),
    toJPEG: (q) => Buffer.from([0xff, 0xd8, q]),
    resize: (op) => { img.resized = op; return img; },
  };
  return img;
}

function eletron(over: Partial<ModuloElectron> = {}): ModuloElectron & { pedidos: unknown[] } {
  const pedidos: unknown[] = [];
  const m: ModuloElectron = {
    screen: { getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }, { id: 2, bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }] },
    desktopCapturer: { getSources: async (op) => { pedidos.push(op); return [{ display_id: "2", thumbnail: imagem(op.thumbnailSize.width, op.thumbnailSize.height, 2) }, { display_id: "1", thumbnail: imagem(op.thumbnailSize.width, op.thumbnailSize.height, 1) }]; } },
    nativeImage: { createFromBitmap: (_b, op) => imagem(op.width, op.height) },
    systemPreferences: { getMediaAccessStatus: () => "granted" },
    shell: { openExternal: async () => undefined },
    globalShortcut: { register: () => true, unregister: () => undefined },
    ...over,
  };
  return Object.assign(m, { pedidos });
}

describe("fonte de tela do Electron", () => {
  it("pede a miniatura em tamanho FÍSICO (bounds x fator) e escolhe a fonte pelo display_id", async () => {
    const e = eletron();
    const f = criarFonteEletron(e, () => null);
    const c = await f.capturarDisplay(1);
    expect(e.pedidos[0]).toEqual({ types: ["screen"], thumbnailSize: { width: 2880, height: 1800 } });
    expect(c?.bitmap.largura).toBe(2880);
    expect(c?.display.fator).toBe(2);
    expect(c?.bitmap.dados[0]).toBe(1); // a fonte do display 1, não a primeira da lista
    expect((await f.capturarDisplay(2))?.display.fator).toBe(1);
    expect(await f.capturarDisplay(99)).toBeNull();
  });

  it("se o SO entrega outro tamanho, o fator efetivo vem da imagem", async () => {
    const e = eletron({ desktopCapturer: { getSources: async () => [{ display_id: "1", thumbnail: imagem(1440, 900) }] } });
    const c = await criarFonteEletron(e, () => null).capturarDisplay(1);
    expect(c?.display.fator).toBe(1);
  });

  it("a captura da janela do app usa capturePage, sem permissão de tela, e deduz o fator", async () => {
    const e = eletron();
    const janela = { isDestroyed: () => false, getBounds: () => ({ x: 10, y: 20, width: 800, height: 600 }), getContentBounds: () => ({ x: 10, y: 50, width: 800, height: 570 }), webContents: { capturePage: async () => imagem(1600, 1140) } };
    const f = criarFonteEletron(e, () => janela);
    expect(f.janelaBounds()).toEqual({ x: 10, y: 20, largura: 800, altura: 600 });
    const c = await f.capturarJanelaApp();
    expect(c?.display).toMatchObject({ largura: 800, altura: 570, fator: 2 });
    expect(e.pedidos).toEqual([]);
  });

  it("sem janela (ou destruída) devolve null", async () => {
    const e = eletron();
    expect(await criarFonteEletron(e, () => null).capturarJanelaApp()).toBeNull();
    const morta = { isDestroyed: () => true, getBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }), getContentBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }), webContents: { capturePage: async () => imagem(1, 1) } };
    expect(criarFonteEletron(e, () => morta).janelaBounds()).toBeNull();
  });
});

describe("codificador, prévia, porta do sistema e tecla global", () => {
  it("codifica PNG/JPEG via nativeImage e a prévia sai no tamanho lógico", () => {
    const e = eletron();
    const cod = criarCodificadorEletron(e);
    const b = { largura: 2, altura: 2, dados: new Uint8Array(16) };
    expect(Array.from(cod.png(b))).toEqual([0x89, 0x50]);
    expect(Array.from(cod.jpeg(b, 85))).toEqual([0xff, 0xd8, 85]);
    const previa = criarPreviaEletron(e);
    const grande = { largura: 400, altura: 200, dados: new Uint8Array(400 * 200 * 4) };
    expect(Array.from(previa(grande, { id: 1, x: 0, y: 0, largura: 200, altura: 100, fator: 2 }))).toEqual([0xff, 0xd8, 80]);
  });

  it("a porta do sistema só pergunta quando chamada; sem askForMediaAccess devolve false", async () => {
    const ask = vi.fn(async () => true);
    const e = eletron({ systemPreferences: { getMediaAccessStatus: () => "denied", askForMediaAccess: ask } });
    const p = criarPortaSistemaEletron(e, "darwin");
    expect(ask).not.toHaveBeenCalled();
    expect(p.statusMedia("screen")).toBe("denied");
    expect(await p.pedirMicrofone()).toBe(true);
    expect(await criarPortaSistemaEletron(eletron({ systemPreferences: { getMediaAccessStatus: () => "granted" } }), "linux").pedirMicrofone()).toBe(false);
  });

  it("tecla global libera só o que registrou e nunca lança", () => {
    const regs: string[] = [];
    const e = eletron({ globalShortcut: { register: (a) => { if (a === "Ocupado") return false; if (a === "Lanca") throw new Error("x"); regs.push(a); return true; }, unregister: (a) => void regs.splice(regs.indexOf(a), 1) } });
    const t = criarTeclaGlobalEletron(e);
    expect(t.registrar("A+B", () => undefined)).toBe(true);
    expect(t.registrar("Ocupado", () => undefined)).toBe(false);
    expect(t.registrar("Lanca", () => undefined)).toBe(false);
    t.liberar("Nunca+Registrado");
    expect(regs).toEqual(["A+B"]);
    t.liberarTodas();
    expect(regs).toEqual([]);
  });
});
