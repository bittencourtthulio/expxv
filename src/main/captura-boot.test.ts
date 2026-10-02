import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANAIS_ENVIO, CANAIS_INVOKE } from "../compartilhado/ipc";
import { ligarCapturaVoz, type ElectronParaCaptura, type LigacaoCapturaVoz } from "./captura-boot";
import { criarRegistroIpc, type IpcMainLike } from "./ipc/registro";
import { urlDoApp } from "./scheme";

function ipcFalso() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ouvintes = new Map<string, (e: unknown, ...a: unknown[]) => void>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: (c, l) => void ouvintes.set(c, l), removeHandler: () => undefined, removeAllListeners: () => undefined };
  return { ipc, handlers, ouvintes };
}

function imagem(l: number, a: number) {
  const dados = Buffer.alloc(l * a * 4);
  for (let i = 0; i < l * a; i++) dados.set([i % 251, (i * 7) % 251, (i * 13) % 251, 255], i * 4);
  const img = { getSize: () => ({ width: l, height: a }), toBitmap: () => dados, toPNG: () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, l, 0, 0, 0, a, 0, 0]), toJPEG: () => Buffer.from([0xff, 0xd8]), resize: () => img };
  return img;
}

let userData = "";
let ligacao: LigacaoCapturaVoz;
let h: ReturnType<typeof ipcFalso>;
const pedirMic = vi.fn(async () => true);
const sessaoChamada = vi.fn(async () => ({ obter: () => undefined, escrever: () => false }));
const enviados: [string, unknown][] = [];

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "boot-cap-"));
  h = ipcFalso();
  enviados.length = 0;
  pedirMic.mockClear();
  sessaoChamada.mockClear();
  const prefs = new Map<string, unknown>();
  const electron = {
    screen: { getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 20, height: 10 }, scaleFactor: 2 }] },
    desktopCapturer: { getSources: vi.fn(async () => [{ display_id: "1", thumbnail: imagem(40, 20) }]) },
    nativeImage: { createFromBitmap: (_b: Buffer, op: { width: number; height: number }) => imagem(op.width, op.height) },
    systemPreferences: { getMediaAccessStatus: () => "granted", askForMediaAccess: pedirMic },
    shell: { openExternal: async () => undefined, trashItem: async () => undefined },
    globalShortcut: { register: () => true, unregister: () => undefined },
    clipboard: { writeText: () => undefined },
  } as unknown as ElectronParaCaptura;
  const registro = criarRegistroIpc({ ipcMain: h.ipc, autorizar: () => true });
  ligacao = ligarCapturaVoz({
    registro, electron, plataforma: "darwin", userData,
    preferencias: { obter: (c) => prefs.get(c) ?? null, definir: async (c, v) => void prefs.set(c, v) },
    janela: () => ({ isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 20, height: 10 }), getContentBounds: () => ({ x: 0, y: 0, width: 20, height: 10 }), webContents: { capturePage: async () => imagem(40, 20), send: (c: string, p: unknown) => void enviados.push([c, p]) }, show: () => undefined, focus: () => undefined }),
    workspaceRaiz: () => null,
    sessoes: sessaoChamada,
    cofre: async () => { throw new Error("cofre não deveria abrir"); },
  });
});
afterEach(async () => {
  await ligacao.encerrar();
  await rm(userData, { recursive: true, force: true });
});

describe("ligação de captura e voz no main", () => {
  it("registra exatamente os canais captura:* e voz:* do contrato", () => {
    const esperados = [...CANAIS_INVOKE, ...CANAIS_ENVIO].filter((c) => /^(captura|voz):/.test(c)).sort();
    expect([...h.handlers.keys(), ...h.ouvintes.keys()].sort()).toEqual(esperados);
    expect(esperados.length).toBeGreaterThanOrEqual(31);
  });

  it("P-48: nenhum serviço, sessão, microfone nem tela é tocado antes do primeiro uso", () => {
    expect(ligacao.criados()).toEqual({ captura: false, voz: false });
    expect(sessaoChamada).not.toHaveBeenCalled();
    expect(pedirMic).not.toHaveBeenCalled();
  });

  it("o primeiro canal cria só o serviço dele, uma vez; o outro continua intocado", async () => {
    await h.handlers.get("captura:estado")!({});
    await h.handlers.get("captura:estado")!({});
    expect(ligacao.criados()).toEqual({ captura: true, voz: false });
    expect(sessaoChamada).toHaveBeenCalledTimes(1);
    await h.handlers.get("voz:estado")!({});
    expect(ligacao.criados()).toEqual({ captura: true, voz: true });
  });

  it("voz:estado não abre o cofre nem pergunta ao SO (motor nenhum)", async () => {
    const e = (await h.handlers.get("voz:estado")!({})) as { motor: string; tem_chave: boolean; microfone: string };
    expect(e).toMatchObject({ motor: "nenhum", tem_chave: false, microfone: "concedida" });
    expect(pedirMic).not.toHaveBeenCalled();
  });

  it("captura da janela do app de ponta a ponta no armazém da pasta de dados", async () => {
    const r = (await h.handlers.get("captura:janela_inteira")!({}, { workspace_id: null })) as { ok: boolean; captura_id: string };
    expect(r.ok).toBe(true);
    const lista = (await h.handlers.get("captura:listar")!({}, { workspace_id: null, depois: null })) as { itens: { id: string; caminho: string }[] };
    expect(lista.itens[0]?.caminho).toBe(join("capturas", `${r.captura_id}.png`));
    expect(enviados.some(([c, p]) => c === "captura:evento" && (p as { tipo: string }).tipo === "mudou")).toBe(true);
  });

  it("payload inválido e id com ../ são recusados antes do manipulador", async () => {
    await expect(h.handlers.get("captura:ler")!({}, { captura_id: "../../etc/passwd", workspace_id: null })).rejects.toThrow(/recusado/);
    await expect(h.handlers.get("captura:regiao_confirmar")!({}, { token: "x", selecao: { x: 0, y: 0, largura: 1, altura: 1 }, workspace_id: null })).rejects.toThrow(/recusado/);
    await expect(h.handlers.get("voz:config_gravar")!({}, { patch: { motor: "nenhum", extra: 1 } })).rejects.toThrow(/recusado/);
    await expect(h.handlers.get("voz:segredo_gravar")!({}, { nome: "outra_chave", valor: "x" })).rejects.toThrow(/recusado/);
    expect(ligacao.criados()).toEqual({ captura: false, voz: false });
  });

  it("voz:audio inválido (ímpar, grande, sem sequência) é ignorado em silêncio e não cria serviço", () => {
    const ouvir = h.ouvintes.get("voz:audio")!;
    ouvir({}, { sequencia: 0, dados: new Uint8Array(3) });
    ouvir({}, { sequencia: 0, dados: new Uint8Array(70_000) });
    ouvir({}, { dados: new Uint8Array(4) });
    ouvir({}, { sequencia: -1, dados: new Uint8Array(4) });
    ouvir({}, { sequencia: 0, dados: [1, 2, 3, 4] });
    expect(ligacao.criados().voz).toBe(false);
  });

  it("a URL do app é a única origem (sanidade do helper de origem)", () => {
    expect(urlDoApp()).toMatch(/^[a-z-]+:\/\/app\/index\.html$/);
  });
});
