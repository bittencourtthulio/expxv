import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventoTerminal } from "../compartilhado/terminais";
import type { OpcoesServicoAtividade } from "../nucleo/terminais/atividade/servico";
import type { AdaptadorPty, ProcessoPty } from "../nucleo/terminais/sessoes";
import { executarBoot } from "./boot";
import { criarContextoTerminais, type DependenciasContexto, type ServicoAtividadeUsado } from "./contexto-terminais";
import type { ServicoDaemon } from "./daemon";

const pastas: string[] = [];
afterEach(() => { while (pastas.length > 0) rmSync(pastas.pop() as string, { recursive: true, force: true }); });

const PEDIDO = { versao: 1, ferramenta_id: "claude", executavel_id: "exe_fixture", argumentos: [] as string[], colunas: 80, linhas: 24, workspace_id: null };
const aguardar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

class PtyFalso implements ProcessoPty {
  pid = 7;
  #dados = new Set<(d: string) => void>();
  onData(fn: (d: string) => void) { this.#dados.add(fn); return { dispose: () => this.#dados.delete(fn) }; }
  onExit() { return { dispose: () => undefined }; }
  write() {} resize() {} pause() {} resume() {} kill() {}
  emitir(d: string) { this.#dados.forEach((fn) => fn(d)); }
}

function montar(extra: Partial<DependenciasContexto> = {}) {
  const dadosApp = mkdtempSync(join(tmpdir(), "ctx-term-"));
  pastas.push(dadosApp);
  const ordem: string[] = [];
  const processos: PtyFalso[] = [];
  const soltar = vi.fn();
  const adaptador: AdaptadorPty = {
    persistente: true,
    spawn: () => { const p = new PtyFalso(); processos.push(p); return p; },
    soltar,
  };
  const daemon = {
    iniciar: vi.fn(() => void ordem.push("daemon")),
    iniciado: false,
    adaptador: () => adaptador,
    sessoesVivas: async () => 0,
    aoSairDoApp: vi.fn(async () => ({ preservou: true, vivas: 1 })),
    encerrarTudo: vi.fn(async () => undefined),
  } as ServicoDaemon;
  let emitirAtividade: OpcoesServicoAtividade["emitir"] = () => undefined;
  const atividadeFalsa: ServicoAtividadeUsado = {
    iniciar: vi.fn(async () => void ordem.push("atividade")),
    observacaoPara: vi.fn(() => ({ argumentos: ["--hook"], ambiente: {} })),
    encerrarSessao: vi.fn(),
    fechar: vi.fn(async () => undefined),
  };
  const criarServicoAtividade = vi.fn((op: OpcoesServicoAtividade) => { emitirAtividade = op.emitir; return atividadeFalsa; });
  const detector = {
    registro: { obter: (id: string) => (id === "exe_fixture" ? { ferramenta_id: "claude", caminho: process.execPath, modo_lancamento: "direto" as const } : undefined), selecionar: vi.fn() },
    detectar: vi.fn(async () => { ordem.push("detectar"); return []; }),
    invalidar: vi.fn(),
  };
  const enviados: EventoTerminal[] = [];
  const notificar = vi.fn(() => true);
  let path: string | null = null;
  const resolverPathDeLogin = vi.fn(async () => { ordem.push("path"); return "/login/bin:/usr/bin"; });
  const ctx = criarContextoTerminais({
    dadosApp, pastaTemp: dadosApp, executavelApp: "/app", scriptDaemon: "/app/daemon.js", e2e: false, semDaemon: false,
    resolverCwd: (w) => { if (w !== null) throw new Error("x"); return dadosApp; },
    permissaoDe: () => "seguro",
    enviar: ((canal: string, payload: EventoTerminal) => { if (canal === "terminais:evento") enviados.push(payload); }) as never,
    janelaId: () => 1,
    notificar,
    aplicarPath: (p) => { ordem.push("aplicarPath"); path = p; },
    detector: detector as never,
    servicoDaemon: daemon,
    criarServicoAtividade,
    resolverPathDeLogin,
    quadro_ms: 5,
    ...extra,
  });
  return { ctx, ordem, processos, adaptador, soltar, daemon, atividadeFalsa, criarServicoAtividade, detector, enviados, notificar, resolverPathDeLogin, emitir: (id: string, e: never) => emitirAtividade(id, e), path: () => path };
}

describe("onda 2 do boot", () => {
  it("criar o contexto e registrar os canais não roda NENHUM serviço", () => {
    const m = montar();
    const registro = { invoke: vi.fn(), envio: vi.fn(), registrados: () => [], remover: vi.fn() };
    m.ctx.registrarIpc({ registro, escolherExecutavel: async () => null, abrirExterno: () => undefined, infoApp: () => ({ versao_app: "1", versao_electron: "1" }) });
    expect(registro.invoke).toHaveBeenCalled();
    expect(m.daemon.iniciar).not.toHaveBeenCalled();
    expect(m.criarServicoAtividade).not.toHaveBeenCalled();
    expect(m.resolverPathDeLogin).not.toHaveBeenCalled();
    expect(m.detector.detectar).not.toHaveBeenCalled();
  });

  it("nenhum serviço da onda 2 (daemon, atividade, PATH de login, detecção) roda antes de `abrir` resolver", async () => {
    const m = montar();
    let liberarJanela!: () => void;
    const janela = new Promise<void>((r) => { liberarJanela = r; });
    const boot = executarBoot({
      abrir: async () => { await janela; m.ordem.push("abrir"); },
      servicos: m.ctx.servicosOnda2(),
      aoFalhar: (n, e) => { throw new Error(`${n}: ${String(e)}`); },
    });
    await aguardar(20);
    expect(m.ordem).toEqual([]); // janela ainda não abriu: nada da onda 2 começou
    liberarJanela();
    const { servicosProntos } = await boot;
    await servicosProntos;
    expect(m.ordem[0]).toBe("abrir");
    expect(m.ordem).toEqual(expect.arrayContaining(["daemon", "atividade", "path", "aplicarPath", "detectar"]));
    // a detecção só varre depois de aplicado o PATH do shell de login
    expect(m.ordem.indexOf("aplicarPath")).toBeLessThan(m.ordem.indexOf("detectar"));
    expect(m.path()).toBe("/login/bin:/usr/bin");
    expect(m.detector.invalidar).toHaveBeenCalled();
  });

  it("erro isolado: PATH de login que falha não impede a detecção nem o daemon", async () => {
    const aoFalhar = vi.fn();
    const m = montar({ resolverPathDeLogin: async () => { throw new Error("shell travou"); } });
    const { servicosProntos } = await executarBoot({ abrir: () => undefined, servicos: m.ctx.servicosOnda2(), aoFalhar });
    await servicosProntos;
    expect(aoFalhar).toHaveBeenCalledWith("path_login", expect.any(Error));
    expect(m.daemon.iniciar).toHaveBeenCalled();
    expect(m.detector.detectar).toHaveBeenCalled();
  });

  it("sessoes() só resolve depois de daemon e atividade iniciados (abrir antes da onda 2 espera, não falha)", async () => {
    const m = montar();
    let pronto = false;
    const espera = m.ctx.sessoes().then((g) => { pronto = true; return g; });
    await aguardar(10);
    expect(pronto).toBe(false);
    const { servicosProntos } = await executarBoot({ abrir: () => undefined, servicos: m.ctx.servicosOnda2(), aoFalhar: () => undefined });
    await servicosProntos;
    await expect(espera).resolves.toBeDefined();
    expect(m.ctx.sessoesAgora()).not.toBeNull();
  });

  it("a detecção do IPC espera o PATH de login antes de varrer (até um limite curto)", async () => {
    const m = montar();
    const registrados = new Map<string, (...a: never[]) => unknown>();
    const registro = { invoke: (c: string, _v: unknown, h: never) => void registrados.set(c, h), envio: vi.fn(), registrados: () => [], remover: vi.fn() };
    m.ctx.registrarIpc({ registro: registro as never, escolherExecutavel: async () => null, abrirExterno: () => undefined, infoApp: () => ({ versao_app: "1", versao_electron: "1" }) });
    const listar = registrados.get("terminais:listar_ferramentas") as (e: { forcar: boolean }) => Promise<unknown>;
    const pendente = listar({ forcar: false });
    await aguardar(10);
    expect(m.detector.detectar).not.toHaveBeenCalled();
    const { servicosProntos } = await executarBoot({ abrir: () => undefined, servicos: m.ctx.servicosOnda2(), aoFalhar: () => undefined });
    await servicosProntos;
    await pendente;
    expect(m.ordem.indexOf("aplicarPath")).toBeLessThan(m.ordem.indexOf("detectar"));
  });

  it("shell de login lento: a detecção pedida pela UI não espera além do limite", async () => {
    const m = montar({ espera_path_ms: 20 });
    const registrados = new Map<string, (...a: never[]) => unknown>();
    const registro = { invoke: (c: string, _v: unknown, h: never) => void registrados.set(c, h), envio: vi.fn(), registrados: () => [], remover: vi.fn() };
    m.ctx.registrarIpc({ registro: registro as never, escolherExecutavel: async () => null, abrirExterno: () => undefined, infoApp: () => ({ versao_app: "1", versao_electron: "1" }) });
    const listar = registrados.get("terminais:listar_ferramentas") as (e: { forcar: boolean }) => Promise<unknown>;
    await listar({ forcar: false }); // o PATH de login nunca chegou (onda 2 não rodou): ainda assim responde
    expect(m.detector.detectar).toHaveBeenCalledTimes(1);
  });
});

async function comSessao(m: ReturnType<typeof montar>) {
  const { servicosProntos } = await executarBoot({ abrir: () => undefined, servicos: m.ctx.servicosOnda2(), aoFalhar: () => undefined });
  await servicosProntos;
  const g = await m.ctx.sessoes();
  const { sessao_id } = g.abrir(PEDIDO);
  await aguardar(1); // setImmediate: sessão passa a "executando"
  return { g, sessao_id };
}

describe("sessões, saída em lote e sinaleira", () => {
  it("limiteSessoes (config limite_paineis) vira o limite do gerenciador, lido a cada abertura", async () => {
    let limite = 2;
    const m = montar({ limiteSessoes: () => limite });
    const { g } = await comSessao(m); // 1ª
    g.abrir(PEDIDO); // 2ª
    expect(() => g.abrir(PEDIDO)).toThrow("Limite de sessões por janela atingido.");
    limite = 3;
    expect(() => g.abrir(PEDIDO)).not.toThrow();
  });

  it("a saída do PTY chega ao renderer: primeiro pedaço imediato, o resto agrupado por quadro", async () => {
    const m = montar();
    await comSessao(m);
    const pty = m.processos[0] as PtyFalso;
    m.enviados.length = 0;
    pty.emitir("a");
    expect(m.enviados.filter((e) => e.tipo === "saida")).toHaveLength(1); // eco imediato
    pty.emitir("b");
    pty.emitir("c");
    expect(m.enviados.filter((e) => e.tipo === "saida")).toHaveLength(1);
    await aguardar(25);
    const saidas = m.enviados.filter((e): e is Extract<EventoTerminal, { tipo: "saida" }> => e.tipo === "saida");
    expect(saidas.map((e) => e.dados)).toEqual(["a", "bc"]);
  });

  it("a sessão ganha os argumentos de observação (hook) e o evento de atividade vira evento + notificação", async () => {
    const m = montar();
    const { sessao_id } = await comSessao(m);
    expect(m.atividadeFalsa.observacaoPara).toHaveBeenCalledWith("claude", sessao_id, "seguro");
    m.enviados.length = 0;
    m.emitir(sessao_id, { tipo: "atividade", atividade: "aguardando" } as never);
    expect(m.enviados.filter((e) => e.tipo === "atividade")).toMatchObject([{ tipo: "atividade", atividade: "aguardando", sessao_id }]);
    expect(m.notificar).toHaveBeenCalledWith("claude", "aguardando");
  });

  it("a conversa avisada pelo hook é guardada fora do daemon e aparece em conversas()", async () => {
    const m = montar();
    const { sessao_id } = await comSessao(m);
    m.emitir(sessao_id, { tipo: "conversa", conversa_id: "conv-123" } as never);
    expect(m.ctx.conversas.listar()).toEqual({ [sessao_id]: "conv-123" });
    const g = await m.ctx.sessoes();
    g.descartar(sessao_id); // descartar a sessão apaga a conversa guardada
    expect(m.ctx.conversas.listar()).toEqual({});
  });

  it("evento de sessão desconhecida ou sem gerenciador não notifica nem quebra", async () => {
    const m = montar();
    const { servicosProntos } = await executarBoot({ abrir: () => undefined, servicos: m.ctx.servicosOnda2(), aoFalhar: () => undefined });
    await servicosProntos;
    m.emitir("sessao_nenhuma", { tipo: "atividade", atividade: "pronto" } as never);
    expect(m.notificar).not.toHaveBeenCalled();
  });
});

describe("encerramento", () => {
  it("sair do app com daemon SOLTA as sessões (não mata), fecha a sinaleira e pergunta ao serviço do daemon", async () => {
    const m = montar();
    const { sessao_id } = await comSessao(m);
    const r = await m.ctx.encerrar();
    expect(r.preservou).toBe(true);
    expect(m.soltar).toHaveBeenCalledWith(sessao_id);
    expect(m.atividadeFalsa.fechar).toHaveBeenCalled();
    expect(m.daemon.aoSairDoApp).toHaveBeenCalledTimes(1);
    expect(m.daemon.encerrarTudo).not.toHaveBeenCalled();
    expect(m.ctx.sessoesAgora()).toBeNull();
  });

  it("fechar só a janela (macOS) solta as sessões e o próximo sessoes() cria um gerenciador novo", async () => {
    const m = montar();
    const { g } = await comSessao(m);
    m.ctx.aoFecharJanela();
    expect(m.ctx.sessoesAgora()).toBeNull();
    const novo = await m.ctx.sessoes();
    expect(novo).not.toBe(g);
    expect(g.listar()).toEqual([]);
  });

  it("encerrarTudo é explícito: mata as sessões e manda o daemon sair", async () => {
    const m = montar();
    await comSessao(m);
    await m.ctx.encerrarTudo();
    expect(m.daemon.encerrarTudo).toHaveBeenCalledTimes(1);
  });
});
