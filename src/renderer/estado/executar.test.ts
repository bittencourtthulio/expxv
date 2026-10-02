import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoExecucao, EventoExecutar, ListaExecucao, ResultadoIniciar } from "../../compartilhado/executar";
import { criarStoreExecutar, estadoAtivo } from "./executar";

const WS = "ws_AAAAAAAAAAAA";
const estado = (fase: EstadoExecucao["fase"], extra: Partial<EstadoExecucao> = {}): EstadoExecucao => ({
  fase, workspace_id: WS, execucao_id: "e1", config_id: "dev", nome: "Rodar (dev)", tipo: "rodar", passo: 1, passos_total: 1, sessao_id: "s1", iniciado_em: 1_000,
  terminado_em: null, porta: null, url: null, codigo: null, sinal: null, mensagem: null, ...extra,
});
const ocioso = estado("ocioso", { execucao_id: null, config_id: null, nome: null, tipo: null, passo: 0, passos_total: 0, sessao_id: null, iniciado_em: null });
const lista = (): ListaExecucao => ({ workspace_id: WS, configuracoes: [], padrao_id: null, armazenamento: "nenhum", vazio: true });

function montar(opcoes: { workspaceId?: string | null } = {}) {
  let evento: (e: EventoExecutar) => void = () => undefined;
  const api = {
    listar: vi.fn(async () => lista()),
    estado: vi.fn(async () => ocioso),
    iniciar: vi.fn(async (): Promise<ResultadoIniciar> => ({ resultado: "iniciado", estado: estado("preparando") })),
    parar: vi.fn(async () => ({ ok: true })),
    reiniciar: vi.fn(async (): Promise<ResultadoIniciar> => ({ resultado: "iniciado", estado: estado("preparando") })),
    gravarConfig: vi.fn(async () => lista()),
    removerConfig: vi.fn(async () => lista()),
    definirPadrao: vi.fn(async () => lista()),
    revogarConfianca: vi.fn(async () => lista()),
    historico: vi.fn(async () => []),
    abrirUrl: vi.fn(async () => ({ ok: true })),
    assinar: vi.fn((cb: (e: EventoExecutar) => void) => { evento = cb; return () => undefined; }),
  };
  let atual = opcoes.workspaceId === undefined ? WS : opcoes.workspaceId;
  const ouvintesWs = new Set<() => void>();
  const workspaces = { obter: () => ({ atual: atual === null ? null : { id: atual } }) as never, assinar: (o: () => void) => { ouvintesWs.add(o); return () => void ouvintesWs.delete(o); } };
  const fechadas: string[] = [];
  const irParaTerminais = vi.fn();
  const store = criarStoreExecutar({ api: () => api as never, workspaces: workspaces as never, fecharSessao: (id) => fechadas.push(id), irParaTerminais, ocioso: (f) => f(), esperaTrocaMs: 50 });
  return { api, store, fechadas, irParaTerminais, emitir: (e: EventoExecutar) => evento(e), trocarWorkspace: (id: string | null) => { atual = id; ouvintesWs.forEach((o) => o()); } };
}
const tudo = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());

describe("store de Executar projeto", () => {
  it("nada é lido do main até haver interação, exceto o estado do workspace atual (em ocioso)", async () => {
    const m = montar();
    expect(m.api.listar).not.toHaveBeenCalled();
    m.store.ligar();
    await tudo();
    expect(m.api.estado).toHaveBeenCalledWith(WS);
    expect(m.api.listar).not.toHaveBeenCalled();
    expect(m.api.iniciar).not.toHaveBeenCalled();
    expect(m.store.obter().estado?.fase).toBe("ocioso");
  });

  it("sem workspace não há estado nem chamada", async () => {
    const m = montar({ workspaceId: null });
    m.store.ligar();
    await tudo();
    expect(m.api.estado).not.toHaveBeenCalled();
    await m.store.alternar();
    expect(m.api.iniciar).not.toHaveBeenCalled();
  });

  it("alternar: executa a padrão quando parado e para quando rodando (F5)", async () => {
    const m = montar();
    m.store.ligar();
    await m.store.alternar();
    expect(m.api.iniciar).toHaveBeenCalledWith(WS, undefined);
    expect(m.store.obter().estado?.fase).toBe("preparando");
    expect(estadoAtivo(m.store.obter().estado)).toBe(true);
    await m.store.alternar();
    expect(m.api.parar).toHaveBeenCalledWith(WS);
    m.emitir({ tipo: "estado", estado: estado("parada") });
    expect(m.store.obter().estado?.fase).toBe("parada");
    await m.store.alternar();
    expect(m.api.iniciar).toHaveBeenCalledTimes(2);
  });

  it("evento de estado de OUTRO workspace é ignorado", async () => {
    const m = montar();
    m.store.ligar();
    await tudo();
    m.emitir({ tipo: "estado", estado: { ...estado("rodando"), workspace_id: "ws_OUTRO" } });
    expect(m.store.obter().estado?.fase).toBe("ocioso");
  });

  it("primeira execução: 'confirmar' abre o diálogo; confirmar devolve o hash; cancelar não roda", async () => {
    const m = montar();
    m.api.iniciar.mockResolvedValueOnce({ resultado: "confirmar", pedido: { config_id: "dev", nome: "Rodar", hash: "a".repeat(40), linhas: ["npm run dev"], cwd: ".", shell: false, ambiente: [], corpo: "vite", motivo: "primeira_vez" } });
    m.store.ligar();
    await m.store.executar();
    expect(m.store.obter().confirmacao?.linhas).toEqual(["npm run dev"]);
    m.store.cancelarConfirmacao();
    expect(m.store.obter().confirmacao).toBeNull();
    expect(m.api.iniciar).toHaveBeenCalledTimes(1);

    m.api.iniciar.mockResolvedValueOnce({ resultado: "confirmar", pedido: { config_id: "dev", nome: "Rodar", hash: "b".repeat(40), linhas: ["npm run dev"], cwd: ".", shell: false, ambiente: [], corpo: null, motivo: "comando_mudou" } });
    await m.store.executar();
    await m.store.confirmar();
    expect(m.api.iniciar).toHaveBeenLastCalledWith(WS, "dev", "b".repeat(40));
    expect(m.store.obter().confirmacao).toBeNull();
    expect(m.store.obter().estado?.fase).toBe("preparando");
  });

  it("'configurar' (nada detectado) abre o assistente", async () => {
    const m = montar();
    m.api.iniciar.mockResolvedValueOnce({ resultado: "configurar" });
    m.store.ligar();
    await m.store.executar();
    expect(m.store.obter().editor).toBe("novo");
    expect(m.api.listar).toHaveBeenCalled();
  });

  it("erro do main vira mensagem, solta o botão e relê o estado (ex.: já havia execução)", async () => {
    const m = montar();
    m.api.iniciar.mockRejectedValueOnce(new Error("Já há uma execução em andamento (Rodar)."));
    m.api.estado.mockResolvedValueOnce(ocioso).mockResolvedValueOnce(estado("rodando"));
    m.store.ligar();
    await tudo();
    await m.store.executar();
    await tudo();
    expect(m.store.obter()).toMatchObject({ erro: "Já há uma execução em andamento (Rodar).", ocupado: false });
    expect(m.store.obter().estado?.fase).toBe("rodando");
    m.store.limparErro();
    expect(m.store.obter().erro).toBeNull();
  });

  it("cliques repetidos enquanto o primeiro não volta não disparam duas execuções", async () => {
    const m = montar();
    let liberar: (r: ResultadoIniciar) => void = () => undefined;
    m.api.iniciar.mockImplementationOnce(() => new Promise<ResultadoIniciar>((r) => { liberar = r; }));
    m.store.ligar();
    const a = m.store.executar();
    await m.store.executar();
    expect(m.api.iniciar).toHaveBeenCalledTimes(1);
    liberar({ resultado: "iniciado", estado: estado("preparando") });
    await a;
  });

  it("trocar de workspace zera o estado e relê o do novo", async () => {
    const m = montar();
    m.store.ligar();
    await tudo();
    m.emitir({ tipo: "estado", estado: estado("rodando") });
    m.trocarWorkspace("ws_BBBBBBBBBBBB");
    expect(m.store.obter()).toMatchObject({ workspaceId: "ws_BBBBBBBBBBBB", estado: null, lista: null, confirmacao: null });
    await tudo();
    expect(m.api.estado).toHaveBeenLastCalledWith("ws_BBBBBBBBBBBB");
  });

  it("configurações, padrão e revogação atualizam a lista; gravar devolve o erro para o editor", async () => {
    const m = montar();
    m.store.ligar();
    await m.store.carregarLista();
    await m.store.definirPadrao("dev");
    await m.store.revogar("dev");
    await m.store.remover("dev");
    expect(m.api.definirPadrao).toHaveBeenCalledWith(WS, "dev");
    expect(m.api.revogarConfianca).toHaveBeenCalledWith(WS, "dev");
    expect(m.api.removerConfig).toHaveBeenCalledWith(WS, "dev");
    m.api.gravarConfig.mockRejectedValueOnce(new Error("cwd: caminho deve ser relativo à raiz do workspace"));
    expect(await m.store.gravar({} as never, false)).toBe("cwd: caminho deve ser relativo à raiz do workspace");
    expect(await m.store.gravar({} as never, true)).toBeNull();
    m.emitir({ tipo: "configuracoes", workspace_id: WS });
    await tudo();
    expect(m.api.listar).toHaveBeenCalledTimes(2);
  });

  it("evento de sessão: rotula o painel 'Execução', pede o terminal quando 'focar' e só fecha a sessão antiga depois que a Tela a troca (ou ao fim da espera)", async () => {
    const m = montar();
    m.store.ligar();
    m.emitir({ tipo: "sessao", workspace_id: WS, sessao_id: "s1", anterior: null, focar: true, nome: "Rodar" });
    expect(m.store.ehSessaoDeExecucao("s1")).toBe(true);
    expect(m.store.obterSessoes().foco).toBe("s1");
    expect(m.irParaTerminais).toHaveBeenCalledTimes(1);
    m.store.consumirFoco("s1");
    expect(m.store.obterSessoes().foco).toBeNull();

    // reuso: a Tela troca no lugar e libera a antiga
    m.emitir({ tipo: "sessao", workspace_id: WS, sessao_id: "s2", anterior: "s1", focar: false, nome: "Rodar" });
    expect(m.store.obterSessoes().anterior.get("s2")).toBe("s1");
    expect(m.store.ehSessaoDeExecucao("s1")).toBe(false);
    expect(m.irParaTerminais).toHaveBeenCalledTimes(1); // "só sinalizar": não leva a tela
    expect(m.fechadas).toEqual([]);
    m.store.liberarAnterior("s1");
    expect(m.fechadas).toEqual(["s1"]);
    m.store.liberarAnterior("s1"); // idempotente
    expect(m.fechadas).toEqual(["s1"]);

    // sem Tela montada: a antiga sai por conta própria
    m.emitir({ tipo: "sessao", workspace_id: WS, sessao_id: "s3", anterior: "s2", focar: false, nome: "Rodar" });
    await new Promise((r) => setTimeout(r, 120));
    expect(m.fechadas).toEqual(["s1", "s2"]);
  });

  it("parar, reiniciar e abrir no navegador chamam o main com o workspace atual (a URL nunca passa pelo renderer)", async () => {
    const m = montar();
    m.store.ligar();
    await m.store.parar();
    await m.store.reiniciar("dev");
    await m.store.abrirNavegador();
    expect(m.api.parar).toHaveBeenCalledWith(WS);
    expect(m.api.reiniciar).toHaveBeenCalledWith(WS, "dev");
    expect(m.api.abrirUrl).toHaveBeenCalledWith(WS);
  });

  it("sem a API (fora do Electron) fica indisponível", () => {
    const store = criarStoreExecutar({ api: () => undefined, workspaces: { obter: () => ({ atual: null }) as never, assinar: () => () => undefined }, ocioso: (f) => f() });
    store.ligar();
    expect(store.obter().disponivel).toBe(false);
  });
});
