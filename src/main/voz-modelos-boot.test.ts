import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VERSAO_CONSENTIMENTO_MODELO, type ListaModelosVoz } from "../compartilhado/voz-local";
import { ligarCapturaVoz, type ElectronParaCaptura, type LigacaoCapturaVoz } from "./captura-boot";
import { criarRegistroIpc, type IpcMainLike } from "./ipc/registro";
import { VALIDADORES_VOZ_MODELOS } from "./voz-modelos-ipc";
import { caminhoDoWorker, criarFabricaProcesso, runtimeDisponivel } from "./voz-modelos-boot";

const CATALOGO = join(__dirname, "../../resources/voz");

function ipcFalso() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  return { ipc, handlers };
}

let userData = "";
let ligacao: LigacaoCapturaVoz;
let h: ReturnType<typeof ipcFalso>;
const fabrica = vi.fn();
const enviados: [string, unknown][] = [];

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "boot-voz-"));
  h = ipcFalso();
  fabrica.mockReset();
  enviados.length = 0;
  const prefs = new Map<string, unknown>();
  const electron = {
    screen: { getAllDisplays: () => [] }, desktopCapturer: { getSources: async () => [] }, nativeImage: {},
    systemPreferences: { getMediaAccessStatus: () => "granted", askForMediaAccess: async () => true },
    shell: { openExternal: async () => undefined, trashItem: async () => undefined }, globalShortcut: { register: () => true, unregister: () => undefined }, clipboard: { writeText: () => undefined },
  } as unknown as ElectronParaCaptura;
  ligacao = ligarCapturaVoz({
    registro: criarRegistroIpc({ ipcMain: h.ipc, autorizar: () => true }), electron, plataforma: "darwin", userData,
    preferencias: { obter: (c) => prefs.get(c) ?? null, definir: async (c, v) => void prefs.set(c, v) },
    janela: () => ({ isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }), getContentBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }), webContents: { capturePage: async () => ({}) as never, send: (c: string, p: unknown) => void enviados.push([c, p]) }, show: () => undefined, focus: () => undefined }),
    workspaceRaiz: () => null,
    sessoes: async () => ({ obter: () => undefined, escrever: () => false }),
    cofre: async () => { throw new Error("cofre não deveria abrir"); },
    voz: { pastaCatalogo: () => CATALOGO, pastaModelos: join(userData, "voz", "modelos"), fabricaProcesso: fabrica as never, runtimeDisponivel: () => ({ ok: true, motivo: null }), cpus: 8 },
  });
});
afterEach(async () => { await ligacao.encerrar(); await rm(userData, { recursive: true, force: true }); });

describe("voz local na ligação do main", () => {
  it("registra os 8 canais voz:modelo* e nenhum processo de reconhecimento nasce (nem ao listar)", async () => {
    for (const c of Object.keys(VALIDADORES_VOZ_MODELOS)) expect(h.handlers.has(c), c).toBe(true);
    expect(fabrica).not.toHaveBeenCalled();
    const l = (await h.handlers.get("voz:modelos_listar")!({})) as ListaModelosVoz;
    expect(l.modelos.map((m) => m.id)).toContain("parakeet-tdt-0.6b-v3-int8");
    expect(l.modelos.find((m) => m.recomendado)?.id).toBe("parakeet-tdt-0.6b-v3-int8");
    expect(l.carregado).toBe(false);
    expect(fabrica).not.toHaveBeenCalled(); // CPU ociosa = 0 e RAM do modelo = 0 até alguém ditar ou rodar o autoteste
    expect(JSON.stringify(l)).not.toContain(userData); // nenhum caminho absoluto no renderer
    expect(l.pasta_exibicao.startsWith("/")).toBe(false);
  });

  it("payload com URL, caminho, host ou id fora do formato é recusado ANTES do manipulador (nenhum serviço criado)", async () => {
    const ruins: Array<[string, unknown]> = [
      ["voz:modelo_baixar", { modelo_id: "parakeet-tdt-0.6b-v3-int8", aceite_versao: VERSAO_CONSENTIMENTO_MODELO, ativar: true, url: "https://evil.example/x.onnx" }],
      ["voz:modelo_baixar", { modelo_id: "../../etc/passwd", aceite_versao: VERSAO_CONSENTIMENTO_MODELO, ativar: true }],
      ["voz:modelo_baixar", { modelo_id: "https://evil.example/m", aceite_versao: VERSAO_CONSENTIMENTO_MODELO, ativar: true }],
      ["voz:modelo_baixar", { modelo_id: "x", aceite_versao: VERSAO_CONSENTIMENTO_MODELO }],
      ["voz:modelo_apagar", { modelo_id: "/Users/x" }],
      ["voz:modelo_ativar", { modelo_id: "a b" }],
      ["voz:modelo_pausar", { modelo_id: "x", caminho: "/tmp" }],
      ["voz:modelos_listar", { x: 1 }],
    ];
    for (const [canal, payload] of ruins) await expect(h.handlers.get(canal)!({}, payload), canal).rejects.toThrow(/recusado/);
    expect(ligacao.criados().voz).toBe(false);
  });

  it("baixar sem o aceite da versão vigente é recusado pelo serviço e não abre rede", async () => {
    await expect(h.handlers.get("voz:modelo_baixar")!({}, { modelo_id: "parakeet-tdt-0.6b-v3-int8", aceite_versao: "antiga", ativar: true })).rejects.toThrow(/consentimento/i);
    await expect(h.handlers.get("voz:modelo_baixar")!({}, { modelo_id: "nao-existe", aceite_versao: VERSAO_CONSENTIMENTO_MODELO, ativar: true })).rejects.toThrow(/desconhecido/i);
  });

  it("sem os parâmetros de voz local (instalação sem a funcionalidade) os canais respondem indisponível, sem estourar", async () => {
    const h2 = ipcFalso();
    const l2 = ligarCapturaVoz({
      registro: criarRegistroIpc({ ipcMain: h2.ipc, autorizar: () => true }), electron: {} as ElectronParaCaptura, plataforma: "darwin", userData,
      preferencias: { obter: () => null, definir: async () => undefined }, janela: () => null, workspaceRaiz: () => null, sessoes: async () => ({ obter: () => undefined, escrever: () => false }), cofre: async () => { throw new Error("x"); },
    });
    await expect(h2.handlers.get("voz:modelos_listar")!({})).rejects.toThrow(/indispon/i);
    await l2.encerrar();
  });
});

describe("processo de reconhecimento", () => {
  it("executável e argumentos SEPARADOS, sem shell, ambiente mínimo com ELECTRON_RUN_AS_NODE, stdout/stderr descartados e canal IPC avançado", () => {
    const filho = Object.assign(new EventEmitter(), { send: vi.fn(), kill: vi.fn() });
    const spawn = vi.fn(() => filho);
    process.env["ANTHROPIC_API_KEY"] = "nao-deve-passar";
    const criar = criarFabricaProcesso({ execPath: "/app/ExpxApp", script: "/app/dist/nucleo/voz/local/worker-sherpa.js", spawn: spawn as never });
    const p = criar();
    delete process.env["ANTHROPIC_API_KEY"];
    const [cmd, args, op] = spawn.mock.calls[0] as unknown as [string, string[], { shell: boolean; stdio: unknown[]; env: Record<string, string>; serialization: string }];
    expect(cmd).toBe("/app/ExpxApp");
    expect(args).toEqual(["/app/dist/nucleo/voz/local/worker-sherpa.js"]);
    expect(op.shell).toBe(false);
    expect(op.stdio).toEqual(["ignore", "ignore", "ignore", "ipc"]);
    expect(op.serialization).toBe("advanced");
    expect(op.env["ELECTRON_RUN_AS_NODE"]).toBe("1");
    expect(Object.keys(op.env).some((k) => /KEY|TOKEN|SECRET/i.test(k))).toBe(false);
    const recebidas: unknown[] = [];
    let saiu = 0;
    p.aoMensagem((m) => recebidas.push(m));
    p.aoSair(() => saiu++);
    filho.emit("message", { t: "pronto" });
    p.enviar({ t: "sair" });
    p.matar();
    filho.emit("exit", 0);
    expect(recebidas).toEqual([{ t: "pronto" }]);
    expect(filho.send).toHaveBeenCalledWith({ t: "sair" });
    expect(filho.kill).toHaveBeenCalledWith("SIGKILL");
    expect(saiu).toBe(1);
  });

  it("o worker de um pacote roda FORA do asar; em desenvolvimento o caminho não muda", () => {
    expect(caminhoDoWorker({ dirMain: "/Apps/X.app/Contents/Resources/app.asar/dist/main", empacotado: true })).toBe("/Apps/X.app/Contents/Resources/app.asar.unpacked/dist/nucleo/voz/local/worker-sherpa.js");
    expect(caminhoDoWorker({ dirMain: "/repo/dist/main", empacotado: false })).toBe("/repo/dist/nucleo/voz/local/worker-sherpa.js");
  });

  it("disponibilidade do runtime por plataforma: macOS arm64/x64 e Windows x64 com o pacote do addon; o resto indisponível com motivo", () => {
    const ok = (id: string): string => id;
    expect(runtimeDisponivel({ platform: "darwin", arch: "arm64", resolver: ok })).toEqual({ ok: true, motivo: null });
    expect(runtimeDisponivel({ platform: "darwin", arch: "x64", resolver: ok }).ok).toBe(true);
    expect(runtimeDisponivel({ platform: "win32", arch: "x64", resolver: ok }).ok).toBe(true);
    expect(runtimeDisponivel({ platform: "win32", arch: "arm64", resolver: ok }).ok).toBe(false);
    expect(runtimeDisponivel({ platform: "linux", arch: "x64", resolver: ok }).motivo).toMatch(/não é suportada/);
    const pedidos: string[] = [];
    const faltando = runtimeDisponivel({ platform: "darwin", arch: "arm64", resolver: (id) => { pedidos.push(id); throw new Error("MODULE_NOT_FOUND"); } });
    expect(faltando.ok).toBe(false);
    expect(faltando.motivo).toMatch(/não está presente/);
    expect(pedidos[0]).toBe("sherpa-onnx-node/package.json");
  });
});
