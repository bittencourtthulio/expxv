import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANAIS_ENVIO, CANAIS_INVOKE } from "../../compartilhado/ipc";
import type { FalhaTerminal } from "../../compartilhado/terminais";
import { DetectorFerramentas } from "../../nucleo/terminais/deteccao";
import { GuardiaoTransicoes } from "../../nucleo/terminais/guardiao";
import { criarArmazemLayout } from "../../nucleo/terminais/layout";
import { GerenciadorSessoes, type AdaptadorPty, type ProcessoPty } from "../../nucleo/terminais/sessoes";
import { CanalRecusadoErro, criarRegistroIpc, type IpcMainLike } from "./registro";
import {
  criarCatalogoDeSessoes, criarTransicoesTerminais, ligarInvalidacaoNoFoco, registrarIpcTerminais,
  type DependenciasTerminais, type SessoesTerminais,
} from "./terminais";

const pastas: string[] = [];
const tmp = (): string => { const p = mkdtempSync(join(tmpdir(), "ipc-term-")); pastas.push(p); return p; };
afterEach(() => { while (pastas.length > 0) rmSync(pastas.pop() as string, { recursive: true, force: true }); });

const CANAIS_TERMINAIS = [...CANAIS_INVOKE, ...CANAIS_ENVIO].filter((c) => c.startsWith("terminais:"));

function ipcFalso() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ouvintes = new Map<string, (e: unknown, ...a: unknown[]) => void>();
  const ipc: IpcMainLike = {
    handle: (c, l) => void handlers.set(c, l),
    on: (c, l) => void ouvintes.set(c, l),
    removeHandler: (c) => void handlers.delete(c),
    removeAllListeners: (c) => void ouvintes.delete(c),
  };
  return { ipc, handlers, ouvintes };
}

const aguardar = () => new Promise<void>((r) => setImmediate(r));
const SESSAO = "sessao_abc123";
const PEDIDO = { versao: 1, ferramenta_id: "personalizado", executavel_id: "exe_fixture", argumentos: [] as string[], colunas: 80, linhas: 24, workspace_id: null };

type SessoesMock = Record<string, ReturnType<typeof vi.fn>>;

function sessoesFalsas(): SessoesMock {
  return {
    abrir: vi.fn(() => ({ versao: 1, sessao_id: SESSAO, estado: "iniciando" })),
    listarMetadados: vi.fn(() => []),
    recuperar: vi.fn(async () => []),
    encerrar: vi.fn(() => true),
    descartar: vi.fn(() => true),
    escrever: vi.fn(() => true),
    redimensionar: vi.fn(() => true),
    interromper: vi.fn(() => true),
    confirmarConsumo: vi.fn(() => true),
    obter: vi.fn(() => ({ sessao_id: SESSAO, ferramenta_id: "terminal", executavel_id: "exe_x", estado: "executando", atividade: null, workspace_id: null, cwd: "/raiz" })),
    diagnostico: vi.fn(() => []),
    persistente: true,
  } as unknown as SessoesMock;
}

function montar(extra: Partial<DependenciasTerminais> = {}, autorizado = () => true) {
  const { ipc, handlers, ouvintes } = ipcFalso();
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: autorizado });
  const sessoes = sessoesFalsas();
  const falhas: FalhaTerminal[] = [];
  const dir = tmp();
  const detector = {
    detectar: vi.fn(async () => []),
    invalidar: vi.fn(),
    registro: { selecionar: vi.fn(), obter: vi.fn() },
  };
  const deps: DependenciasTerminais = {
    registro,
    sessoes: async () => sessoes as unknown as SessoesTerminais,
    detector: detector as never,
    escolherExecutavel: async () => null,
    abrirExterno: vi.fn(),
    armazemLayout: (ws) => criarArmazemLayout(dir, ws),
    conversas: { listar: () => ({ [SESSAO]: "conv_1" }) },
    infoApp: () => ({ versao_app: "0.1.0", versao_electron: "37.0.0" }),
    enviarFalha: (f) => void falhas.push(f),
    ...extra,
  };
  registrarIpcTerminais(deps);
  const invocar = (canal: string, payload?: unknown) => (handlers.get(canal) as (e: unknown, p?: unknown) => unknown)({}, payload);
  const enviar = (canal: string, payload?: unknown) => (ouvintes.get(canal) as (e: unknown, p?: unknown) => void)({}, payload);
  return { registro, handlers, ouvintes, sessoes, falhas, detector, deps, invocar, enviar, dir };
}

describe("registro dos canais terminais:*", () => {
  it("registra os 17 canais do contrato (14 invoke + 3 envio), nenhum a mais", () => {
    const { registro } = montar();
    expect(CANAIS_TERMINAIS).toHaveLength(17);
    expect(registro.registrados().filter((c) => c.startsWith("terminais:"))).toEqual([...CANAIS_TERMINAIS].sort());
  });

  it("registro único: registrar de novo os mesmos canais é erro (canal duplicado)", () => {
    const { deps } = montar();
    expect(() => registrarIpcTerminais(deps)).toThrow(/duplicado/);
  });

  it("remetente indevido é recusado em TODOS os canais e nada chega às sessões", async () => {
    const { handlers, ouvintes, sessoes } = montar({}, () => false);
    for (const canal of CANAIS_INVOKE.filter((c) => c.startsWith("terminais:"))) {
      await expect((handlers.get(canal) as (e: unknown, p?: unknown) => Promise<unknown>)({}, PEDIDO)).rejects.toBeInstanceOf(CanalRecusadoErro);
    }
    for (const canal of CANAIS_ENVIO.filter((c) => c.startsWith("terminais:"))) (ouvintes.get(canal) as (e: unknown, p?: unknown) => void)({}, { sessao_id: SESSAO, dados: "x" });
    await aguardar();
    for (const fn of Object.values(sessoes)) if (typeof fn === "function" && "mock" in fn) expect(fn).not.toHaveBeenCalled();
  });

  it("payload inválido é recusado antes do manipulador (campo extra, tipo errado, id malformado)", async () => {
    const { invocar, enviar, sessoes } = montar();
    await expect(invocar("terminais:encerrar", { sessao_id: "../../etc" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(invocar("terminais:encerrar", { sessao_id: SESSAO, extra: 1 })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(invocar("terminais:listar_ferramentas", { forcar: "sim" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(invocar("terminais:abrir_link", { url: 5 })).rejects.toBeInstanceOf(CanalRecusadoErro);
    enviar("terminais:escrever", { sessao_id: SESSAO, dados: "a\0b" });
    enviar("terminais:redimensionar", { sessao_id: SESSAO, colunas: 1, linhas: 24 });
    await aguardar();
    expect(sessoes["encerrar"]).not.toHaveBeenCalled();
    expect(sessoes["escrever"]).not.toHaveBeenCalled();
    expect(sessoes["redimensionar"]).not.toHaveBeenCalled();
  });
});

describe("abrir sessão", () => {
  it("NUNCA aceita cwd do renderer (nem variantes): o pedido é recusado e nada é aberto", async () => {
    const { invocar, sessoes } = montar();
    for (const campo of ["cwd", "raiz", "diretorio", "env"]) {
      await expect(invocar("terminais:abrir", { ...PEDIDO, [campo]: "/etc" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    }
    expect(sessoes["abrir"]).not.toHaveBeenCalled();
    await expect(invocar("terminais:abrir", PEDIDO)).resolves.toMatchObject({ sessao_id: SESSAO });
    expect(sessoes["abrir"]).toHaveBeenCalledTimes(1);
  });

  it("o cwd sai do workspace pelo resolverCwd do main; workspace desconhecido não abre", () => {
    const processos: Array<{ cwd: string }> = [];
    const adaptador: AdaptadorPty = { spawn: (_e, _a, o) => { processos.push({ cwd: o.cwd }); return processoInerte(); } };
    const g = gerenciador({ adaptador, resolverCwd: (w) => { if (w !== null) throw new Error("x"); return "/raiz/atual"; } });
    g.abrir(PEDIDO);
    expect(processos[0]?.cwd).toBe("/raiz/atual");
    expect(() => g.abrir({ ...PEDIDO, workspace_id: "ws_inexistente" })).toThrow(/Workspace desconhecido/);
  });
});

function processoInerte(): ProcessoPty {
  const d = { dispose: () => undefined };
  return { pid: 1, onData: () => d, onExit: () => d, write: () => undefined, resize: () => undefined, pause: () => undefined, resume: () => undefined, kill: () => undefined };
}

function gerenciador(op: { adaptador: AdaptadorPty; resolverCwd?: (w: string | null) => string; ferramenta?: string; permissao?: (w: string | null) => never | "seguro" | "automatico" | string }) {
  const ferramenta = op.ferramenta ?? "personalizado";
  return new GerenciadorSessoes({
    resolverCwd: op.resolverCwd ?? (() => "/raiz"),
    janela_id: 1, geracao: 1,
    registro: { obter: (id) => (id === "exe_fixture" ? { ferramenta_id: ferramenta, caminho: process.execPath, modo_lancamento: "direto" } : undefined) },
    adaptador: op.adaptador,
    catalogo: criarCatalogoDeSessoes((op.permissao ?? (() => "seguro")) as never),
  });
}

describe("permissão do workspace (D-14)", () => {
  function argvAberto(permissao: (w: string | null) => unknown, ferramenta = "claude"): string[] {
    let argv: string[] = [];
    const adaptador: AdaptadorPty = { spawn: (_e, a) => { argv = [...a]; return processoInerte(); } };
    gerenciador({ adaptador, ferramenta, permissao: permissao as never }).abrir({ ...PEDIDO, ferramenta_id: ferramenta });
    return argv;
  }

  it("'seguro' (padrão) não injeta argumentos automáticos em nenhuma ferramenta", () => {
    for (const f of ["claude", "codex", "gemini", "opencode", "aider", "qwen", "grok"]) expect(argvAberto(() => "seguro", f)).toEqual([]);
  });

  it("'automatico' injeta os argumentos oficiais da ferramenta", () => {
    expect(argvAberto(() => "automatico", "claude")).toContain("--dangerously-skip-permissions");
  });

  it("valor inesperado ou erro ao consultar a permissão cai em 'seguro'", () => {
    expect(argvAberto(() => "qualquer")).toEqual([]);
    expect(argvAberto(() => { throw new Error("sem workspace"); })).toEqual([]);
    expect(argvAberto(() => undefined)).toEqual([]);
  });

  it("o bypass total de sandbox do Codex nunca sai, nem no automático", () => {
    expect(argvAberto(() => "automatico", "codex").join(" ")).not.toContain("dangerously-bypass");
  });
});

describe("abrir_link", () => {
  it("recusa javascript:, file:, data:, credenciais e lixo; nada chega ao navegador", async () => {
    const abrirExterno = vi.fn();
    const { invocar } = montar({ abrirExterno });
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "https://u:p@exemplo.com/", "https://user@exemplo.com/", "ftp://exemplo.com", "não é url", "https://exemplo.com/\u0007"]) {
      await expect(invocar("terminais:abrir_link", { url })).resolves.toBe(false);
    }
    expect(abrirExterno).not.toHaveBeenCalled();
  });

  it("abre http(s) limpo com a URL normalizada", async () => {
    const abrirExterno = vi.fn();
    const { invocar } = montar({ abrirExterno });
    await expect(invocar("terminais:abrir_link", { url: "https://exemplo.com/a b" })).resolves.toBe(true);
    await expect(invocar("terminais:abrir_link", { url: "http://localhost:3000" })).resolves.toBe(true);
    expect(abrirExterno).toHaveBeenNthCalledWith(1, "https://exemplo.com/a%20b");
    expect(abrirExterno).toHaveBeenNthCalledWith(2, "http://localhost:3000/");
  });
});

describe("detecção com cache", () => {
  function executavel(dir: string, nome: string): void {
    writeFileSync(join(dir, nome), "#!/bin/sh\n");
    chmodSync(join(dir, nome), 0o755);
  }

  it("é cacheada e só é refeita quando o foco da janela (ou 'forcar') invalida", async () => {
    const dir = tmp();
    executavel(dir, "claude");
    const detector = new DetectorFerramentas({ path: dir, diretorios_convencionais: [], plataforma: "darwin", lerVersao: async () => "1.0.0" });
    const { invocar } = montar({ detector });
    const lista = async (forcar = false) => (await invocar("terminais:listar_ferramentas", { forcar })) as Array<{ id: string; instalado: boolean }>;
    const instalada = (l: Array<{ id: string; instalado: boolean }>, id: string) => l.find((f) => f.id === id)?.instalado;

    expect(instalada(await lista(), "claude")).toBe(true);
    executavel(dir, "codex");
    expect(instalada(await lista(), "codex")).toBe(false); // cache: ainda não viu o codex

    const focos: Array<() => void> = [];
    ligarInvalidacaoNoFoco({ on: (_e, cb) => void focos.push(cb) }, detector);
    focos[0]?.(); // a janela ganhou foco
    expect(instalada(await lista(), "codex")).toBe(true);

    executavel(dir, "gemini");
    expect(instalada(await lista(), "gemini")).toBe(false);
    expect(instalada(await lista(true), "gemini")).toBe(true); // forcar invalida
  });

  it("ligarInvalidacaoNoFoco devolve o cancelamento", () => {
    const invalidar = vi.fn();
    const ouvintes = new Set<() => void>();
    const cancelar = ligarInvalidacaoNoFoco({ on: (_e, cb) => void ouvintes.add(cb), removeListener: (_e, cb) => void ouvintes.delete(cb) }, { invalidar });
    [...ouvintes][0]?.();
    expect(invalidar).toHaveBeenCalledTimes(1);
    cancelar();
    expect(ouvintes.size).toBe(0);
  });
});

describe("escolher executável", () => {
  it("cancelar devolve null; caminho inválido lança; válido registra, invalida a detecção e devolve o id opaco", async () => {
    const dir = tmp();
    const exe = join(dir, "minha-cli");
    writeFileSync(exe, "#!/bin/sh\n");
    chmodSync(exe, 0o755);
    const detector = new DetectorFerramentas({ path: dir, diretorios_convencionais: [], plataforma: "darwin", lerVersao: async () => null });
    const invalidar = vi.spyOn(detector, "invalidar");
    let escolhido: string | null = null;
    const { invocar } = montar({ detector, escolherExecutavel: async () => escolhido });

    await expect(invocar("terminais:selecionar_executavel", { ferramenta_id: "personalizado" })).resolves.toBeNull();
    escolhido = "relativo/cli";
    await expect(invocar("terminais:selecionar_executavel", { ferramenta_id: "personalizado" })).rejects.toThrow(/absoluto/);
    escolhido = join(dir, "nao-existe");
    await expect(invocar("terminais:selecionar_executavel", { ferramenta_id: "personalizado" })).rejects.toThrow(/não existe/);
    expect(invalidar).not.toHaveBeenCalled();
    escolhido = exe;
    const r = (await invocar("terminais:selecionar_executavel", { ferramenta_id: "personalizado" })) as { executavel_id: string; instalado: boolean };
    expect(r.instalado).toBe(true);
    expect(r.executavel_id).toMatch(/^exe_/);
    expect(detector.registro.obter(r.executavel_id)?.ferramenta_id).toBe("personalizado");
    expect(invalidar).toHaveBeenCalledTimes(1);
  });
});

describe("canais de sessão", () => {
  it("encaminham ao gerenciador: recuperar, encerrar, descartar, confirmar_consumo, listar", async () => {
    const { invocar, sessoes } = montar();
    await expect(invocar("terminais:recuperar")).resolves.toEqual({ sessoes: [] });
    await invocar("terminais:encerrar", { sessao_id: SESSAO });
    await invocar("terminais:descartar", { sessao_id: SESSAO });
    await invocar("terminais:confirmar_consumo", { sessao_id: SESSAO, bytes: 1000 });
    await invocar("terminais:listar_sessoes");
    expect(sessoes["encerrar"]).toHaveBeenCalledWith(SESSAO);
    expect(sessoes["descartar"]).toHaveBeenCalledWith(SESSAO);
    expect(sessoes["confirmarConsumo"]).toHaveBeenCalledWith(SESSAO, 1000);
    expect(sessoes["listarMetadados"]).toHaveBeenCalled();
  });

  it("descartar avisa o domínio ANTES do descarte lógico e uma falha do aviso não impede o descarte", async () => {
    const ordem: string[] = [];
    const aoDescartar = vi.fn((id: string) => { ordem.push(`dominio:${id}`); });
    const { invocar, sessoes } = montar({ aoDescartar });
    (sessoes["descartar"] as ReturnType<typeof vi.fn>).mockImplementation(() => { ordem.push("descartar"); return true; });
    await invocar("terminais:descartar", { sessao_id: SESSAO });
    expect(ordem).toEqual([`dominio:${SESSAO}`, "descartar"]);
    const falho = montar({ aoDescartar: () => { throw new Error("banco indisponível"); } });
    await expect(falho.invocar("terminais:descartar", { sessao_id: SESSAO })).resolves.toBe(true);
    expect(falho.sessoes["descartar"]).toHaveBeenCalledWith(SESSAO);
  });

  it("escrever avisa o pulso do bichinho (só o id da sessão, nunca o conteúdo) e uma falha do aviso não impede a escrita", async () => {
    const aoEscrever = vi.fn(() => { throw new Error("falhou"); });
    const { enviar, sessoes } = montar({ aoEscrever });
    enviar("terminais:escrever", { sessao_id: SESSAO, dados: "segredo" });
    await aguardar();
    expect(aoEscrever).toHaveBeenCalledWith(SESSAO);
    expect(sessoes["escrever"]).toHaveBeenCalledWith(SESSAO, "segredo");
  });

  it("escrever/redimensionar/interromper encaminham em ordem; falha volta por terminais:falha", async () => {
    const { enviar, sessoes, falhas } = montar();
    enviar("terminais:escrever", { sessao_id: SESSAO, dados: "a" });
    enviar("terminais:escrever", { sessao_id: SESSAO, dados: "b" });
    enviar("terminais:redimensionar", { sessao_id: SESSAO, colunas: 100, linhas: 30 });
    enviar("terminais:interromper", { sessao_id: SESSAO });
    await aguardar();
    expect(sessoes["escrever"]?.mock.calls).toEqual([[SESSAO, "a"], [SESSAO, "b"]]);
    expect(sessoes["redimensionar"]).toHaveBeenCalledWith(SESSAO, 100, 30);
    expect(sessoes["interromper"]).toHaveBeenCalledWith(SESSAO);

    sessoes["escrever"]?.mockImplementation(() => { throw new Error("Sessão desconhecida nesta janela."); });
    enviar("terminais:escrever", { sessao_id: SESSAO, dados: "c" });
    await aguardar();
    expect(falhas).toEqual([{ sessao_id: SESSAO, codigo: "falha_no_envio", mensagem: "Sessão desconhecida nesta janela." }]);
  });

  it("anexar usa a raiz da sessão (nunca um caminho do renderer) e recusa sessão desconhecida", async () => {
    const preparar = vi.fn(async () => ({ caminhos: [".x/entradas/a.png"], texto: ".x/entradas/a.png " }));
    const { invocar, sessoes } = montar({ prepararAnexos: preparar as never });
    const itens = [{ caminho: "/tmp/a.png" }];
    await expect(invocar("terminais:anexar", { sessao_id: SESSAO, itens })).resolves.toMatchObject({ caminhos: [".x/entradas/a.png"] });
    expect(preparar).toHaveBeenCalledWith("/raiz", SESSAO, itens);
    sessoes["obter"]?.mockReturnValue(undefined);
    await expect(invocar("terminais:anexar", { sessao_id: SESSAO, itens })).rejects.toThrow(/desconhecida/);
  });

  it("layout grava e lê por workspace; layout inválido é recusado pelo validador", async () => {
    const { invocar } = montar();
    const layout = { versao: 2, ativa: SESSAO, abas: [{ arvore: { tipo: "terminal", sessao_id: SESSAO } }], fixadas: [] };
    await expect(invocar("terminais:layout_ler", { workspace_id: "ws_a" })).resolves.toBeNull();
    await expect(invocar("terminais:layout_gravar", { workspace_id: "ws_a", layout })).resolves.toBe(true);
    await expect(invocar("terminais:layout_ler", { workspace_id: "ws_a" })).resolves.toEqual(layout);
    await expect(invocar("terminais:layout_ler", { workspace_id: "ws_b" })).resolves.toBeNull();
    await expect(invocar("terminais:layout_gravar", { workspace_id: "ws_a", layout: { ...layout, versao: 9 } })).rejects.toBeInstanceOf(CanalRecusadoErro);
  });

  it("diagnóstico é só metadados (sem a pasta pessoal) e conversas vêm do armazém", async () => {
    const { invocar, sessoes } = montar();
    sessoes["diagnostico"]?.mockReturnValue([{ sessao_id: SESSAO, ferramenta_id: "terminal", estado: "executando", atividade: null, pid: 42, criada_em: 1, quantidade_argumentos: 2 }]);
    const { texto } = (await invocar("terminais:diagnostico")) as { texto: string };
    expect(texto).toContain(SESSAO);
    expect(texto).toContain("\"quantidade_argumentos\": 2");
    expect(texto).not.toContain(homedir());
    await expect(invocar("terminais:conversas")).resolves.toEqual({ [SESSAO]: "conv_1" });
  });
});

describe("guardião de transições", () => {
  const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  function sessoesGuardadas(ativas: boolean) {
    return { tem_sessoes_ativas: ativas, bloquearAdmissao: vi.fn(), liberarAdmissao: vi.fn(), encerrarTodasEAguardar: vi.fn(async () => undefined) };
  }

  it("serializa trocas de workspace e fechamento: nunca duas ao mesmo tempo, na ordem do pedido", async () => {
    const ordem: string[] = [];
    const t = criarTransicoesTerminais({ guardiao: new GuardiaoTransicoes(), sessoes: () => null, persistente: () => true, confirmar: async () => true });
    const a = t.trocarWorkspace(async () => { ordem.push("a:ini"); await tick(20); ordem.push("a:fim"); });
    const b = t.fecharJanela(async () => { ordem.push("b:ini"); await tick(1); ordem.push("b:fim"); });
    const c = t.trocarWorkspace(async () => { ordem.push("c"); });
    await Promise.all([a, b, c]);
    expect(ordem).toEqual(["a:ini", "a:fim", "b:ini", "b:fim", "c"]);
  });

  it("com daemon (persistente) não confirma nem encerra: sessões só são soltas", async () => {
    const confirmar = vi.fn(async () => true);
    const s = sessoesGuardadas(true);
    const t = criarTransicoesTerminais({ guardiao: new GuardiaoTransicoes(), sessoes: () => s, persistente: () => true, confirmar });
    await expect(t.trocarWorkspace(async () => undefined)).resolves.toBe(true);
    expect(confirmar).not.toHaveBeenCalled();
    expect(s.encerrarTodasEAguardar).not.toHaveBeenCalled();
  });

  it("sem daemon e com sessões ativas: confirma, encerra e executa; recusar não executa e libera a admissão", async () => {
    const s = sessoesGuardadas(true);
    let resposta = false;
    const executar = vi.fn(async () => undefined);
    const t = criarTransicoesTerminais({ guardiao: new GuardiaoTransicoes(), sessoes: () => s, persistente: () => false, confirmar: async () => resposta });
    await expect(t.fecharJanela(executar)).resolves.toBe(false);
    expect(executar).not.toHaveBeenCalled();
    expect(s.bloquearAdmissao).toHaveBeenCalled();
    expect(s.liberarAdmissao).toHaveBeenCalledTimes(1);
    resposta = true;
    await expect(t.fecharJanela(executar)).resolves.toBe(true);
    expect(s.encerrarTodasEAguardar).toHaveBeenCalledTimes(1);
    expect(executar).toHaveBeenCalledTimes(1);
  });
});
