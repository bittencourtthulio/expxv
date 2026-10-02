// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EstadoExecucao, EventoExecutar, ItemConfigExecucao, ListaExecucao, PedidoConfirmacaoExecutar, ResultadoIniciar } from "../../compartilhado/executar";
import { criarStoreExecutar } from "../estado/executar";
import { BotaoExecutar } from "./BotaoExecutar";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const WS = "ws_AAAAAAAAAAAA";
const est = (fase: EstadoExecucao["fase"], extra: Partial<EstadoExecucao> = {}): EstadoExecucao => ({
  fase, workspace_id: WS, execucao_id: "e1", config_id: "dev", nome: "Rodar (dev)", tipo: "rodar", passo: 1, passos_total: 1, sessao_id: "s1", iniciado_em: Date.now() - 42_000,
  terminado_em: null, porta: null, url: null, codigo: null, sinal: null, mensagem: null, ...extra,
});
const ocioso = est("ocioso", { execucao_id: null, config_id: null, nome: null, tipo: null, passo: 0, passos_total: 0, sessao_id: null, iniciado_em: null });
const item = (id: string, nome: string, extra: Partial<ItemConfigExecucao> = {}): ItemConfigExecucao => ({
  id, nome, tipo: "rodar", executavel: "npm", argumentos: ["run", id], cwd: ".", ambiente: {}, pre_passos: [], porta: null, url: null, abrir_navegador: false, reiniciar_ao_salvar: false, grupo: null, shell: null,
  origem: "detectada", padrao: false, confiavel: false, comando: `npm run ${id}`, ...extra,
});
const LISTA: ListaExecucao = { workspace_id: WS, padrao_id: "dev", armazenamento: "nenhum", vazio: false, configuracoes: [item("dev", "Rodar (dev)", { padrao: true }), item("build", "Build completo", { tipo: "build" }), item("test", "Testes", { tipo: "teste" })] };
const PEDIDO: PedidoConfirmacaoExecutar = { config_id: "dev", nome: "Rodar (dev)", hash: "c".repeat(40), linhas: ["npm run dev"], cwd: ".", shell: false, ambiente: [], corpo: "vite", motivo: "primeira_vez" };

async function montar(inicial: EstadoExecucao = ocioso, lista: ListaExecucao = LISTA) {
  let evento: (e: EventoExecutar) => void = () => undefined;
  const api = {
    listar: vi.fn(async () => lista),
    estado: vi.fn(async () => inicial),
    iniciar: vi.fn(async (): Promise<ResultadoIniciar> => ({ resultado: "iniciado", estado: est("preparando") })),
    parar: vi.fn(async () => ({ ok: true })),
    reiniciar: vi.fn(async (): Promise<ResultadoIniciar> => ({ resultado: "iniciado", estado: est("preparando") })),
    gravarConfig: vi.fn(async () => lista),
    removerConfig: vi.fn(async () => lista),
    definirPadrao: vi.fn(async () => lista),
    revogarConfianca: vi.fn(async () => lista),
    historico: vi.fn(async () => [{ execucao_id: "h1", config_id: "dev", nome: "Rodar (dev)", comando: "npm run dev", iniciado_em: "2026-01-01T00:00:00.000Z", duracao_ms: 83_000, codigo: 1, sinal: null, resultado: "falha" as const }]),
    abrirUrl: vi.fn(async () => ({ ok: true })),
    assinar: vi.fn((cb: (e: EventoExecutar) => void) => { evento = cb; return () => undefined; }),
  };
  const workspaces = { obter: () => ({ atual: { id: WS } }) as never, assinar: () => () => undefined };
  const store = criarStoreExecutar({ api: () => api as never, workspaces: workspaces as never, fecharSessao: () => undefined, irParaTerminais: () => undefined, ocioso: (f) => f() });
  render(<BotaoExecutar store={store} />);
  await waitFor(() => expect(api.estado).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  return { api, store, emitir: (e: EventoExecutar) => act(() => evento(e)) };
}

describe("botão ▶ Executar / ■ Parar", () => {
  it("ocioso: ▶ com o nome acessível 'Executar projeto' e o chevron do menu", async () => {
    await montar();
    const botao = screen.getByRole("button", { name: "Executar projeto" });
    expect(botao.getAttribute("data-acao")).toBe("executar");
    expect(botao.getAttribute("title")).toContain("F5");
    const chevron = screen.getByRole("button", { name: "Configurações de execução" });
    expect(chevron.getAttribute("aria-haspopup")).toBe("menu");
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
  });

  it("clicar executa a configuração padrão (sem config_id: o main decide) e vira ■ Parar com chip", async () => {
    const m = await montar();
    fireEvent.click(screen.getByRole("button", { name: "Executar projeto" }));
    await waitFor(() => expect(m.api.iniciar).toHaveBeenCalledWith(WS, undefined));
    await screen.findByRole("button", { name: /^Parar /i });
    expect(screen.getByRole("button", { name: /^Parar / }).getAttribute("data-acao")).toBe("parar");
    await m.emitir({ tipo: "estado", estado: est("rodando", { porta: 5173, url: "http://localhost:5173/" }) });
    expect(screen.getByText(/rodando há 00:4\d · porta 5173/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Rodar (dev): rodando na porta 5173.");
    fireEvent.click(screen.getByRole("button", { name: /^Parar / }));
    await waitFor(() => expect(m.api.parar).toHaveBeenCalledWith(WS));
  });

  it("rodando com URL: botão 'Abrir no navegador' chama o main (a URL não passa pelo renderer)", async () => {
    const m = await montar(est("rodando", { porta: 3000, url: "http://localhost:3000/" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Parar / })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Abrir http:\/\/localhost:3000\/ no navegador/ }));
    await waitFor(() => expect(m.api.abrirUrl).toHaveBeenCalledWith(WS));
  });

  it("parando: botão desabilitado; saiu com erro: ▶ de novo com chip 'saiu com código N' e a mensagem no tooltip", async () => {
    const m = await montar(est("rodando"));
    await m.emitir({ tipo: "estado", estado: est("parando") });
    const parando = screen.getByRole("button", { name: /Parando/ }) as HTMLButtonElement;
    expect(parando.disabled).toBe(true);
    await m.emitir({ tipo: "estado", estado: est("falhou", { codigo: 1, mensagem: "Build falhou (código 1): veja o painel Execução." }) });
    const botao = screen.getByRole("button", { name: /^Executar / });
    expect(botao.getAttribute("data-acao")).toBe("executar");
    expect(botao.getAttribute("title")).toContain("Build falhou");
    expect(screen.getByText("saiu com código 1")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Build falhou");
  });

  it("primeira execução: abre o diálogo com o comando exato; 'Confiar neste projeto e executar' manda o hash; Cancelar não roda", async () => {
    const m = await montar();
    m.api.iniciar.mockResolvedValueOnce({ resultado: "confirmar", pedido: PEDIDO });
    fireEvent.click(screen.getByRole("button", { name: "Executar projeto" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByLabelText("Comando exato").textContent).toBe("$ npm run dev");
    expect(within(dialogo).getByLabelText("Conteúdo do script").textContent).toBe("vite");
    expect(document.activeElement?.textContent).toBe("Cancelar"); // o caminho seguro tem o foco inicial
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.api.iniciar).toHaveBeenCalledTimes(1);

    m.api.iniciar.mockResolvedValueOnce({ resultado: "confirmar", pedido: PEDIDO });
    fireEvent.click(screen.getByRole("button", { name: "Executar projeto" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confiar neste projeto e executar" }));
    await waitFor(() => expect(m.api.iniciar).toHaveBeenLastCalledWith(WS, "dev", "c".repeat(40)));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("comando que mudou e shell: o diálogo avisa", async () => {
    const m = await montar();
    m.api.iniciar.mockResolvedValueOnce({ resultado: "confirmar", pedido: { ...PEDIDO, motivo: "comando_mudou", shell: true, linhas: ["[shell] make && ./app"], ambiente: ["NODE_ENV"] } });
    fireEvent.click(screen.getByRole("button", { name: "Executar projeto" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByRole("heading").textContent).toContain("O comando mudou");
    expect(within(dialogo).getByRole("note").textContent).toContain("em um shell");
    expect(within(dialogo).getByText("NODE_ENV")).toBeTruthy();
  });
});

describe("menu suspenso (ARIA)", () => {
  it("abre ao clicar no chevron, lê a lista só agora, marca a padrão e fecha com Esc devolvendo o foco", async () => {
    const m = await montar();
    expect(m.api.listar).not.toHaveBeenCalled();
    const chevron = screen.getByRole("button", { name: "Configurações de execução" });
    fireEvent.click(chevron);
    const menu = await screen.findByRole("menu", { name: "Configurações de execução" });
    await waitFor(() => expect(m.api.listar).toHaveBeenCalledTimes(1));
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
    const itens = await within(menu).findAllByRole("menuitem");
    expect(within(menu).getByRole("menuitem", { name: "Executar Rodar (dev) (padrão)" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Executar Build completo" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Rodar (dev) é a configuração padrão" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Definir Testes como padrão" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Editar configurações…" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Configurar com IA…" })).toBeTruthy();
    expect(itens.length).toBe(8); // 3 configurações × (executar + padrão) + Configurar com IA + Editar
    expect(within(menu).getByRole("group", { name: "Últimas execuções" }).textContent).toContain("código 1 · 01:23");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(chevron);
  });

  it("escolher uma configuração executa exatamente ela; a estrela define a padrão", async () => {
    const m = await montar();
    fireEvent.click(screen.getByRole("button", { name: "Configurações de execução" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Executar Build completo" }));
    await waitFor(() => expect(m.api.iniciar).toHaveBeenCalledWith(WS, "build"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Configurações de execução" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Definir Testes como padrão" }));
    await waitFor(() => expect(m.api.definirPadrao).toHaveBeenCalledWith(WS, "test"));
  });

  it("setas, Home e End percorrem os itens", async () => {
    await montar();
    fireEvent.click(screen.getByRole("button", { name: "Configurações de execução" }));
    const menu = await screen.findByRole("menu");
    await within(menu).findAllByRole("menuitem");
    const itens = within(menu).getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(itens[0]));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(itens[1]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(itens[itens.length - 1]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(itens[0]);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(itens[itens.length - 1]);
  });

  it("rodando: o menu oferece Reiniciar e Parar", async () => {
    const m = await montar(est("rodando"));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Parar / })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Configurações de execução" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Reiniciar/ }));
    await waitFor(() => expect(m.api.reiniciar).toHaveBeenCalledWith(WS, "dev"));
  });

  it("sem configuração detectada: avisa e 'Editar configurações…' abre o assistente", async () => {
    const m = await montar(ocioso, { ...LISTA, configuracoes: [], padrao_id: null, vazio: true });
    fireEvent.click(screen.getByRole("button", { name: "Configurações de execução" }));
    expect(await screen.findByText(/Nenhuma configuração detectada neste projeto\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Editar configurações…" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByRole("heading").textContent).toBe("Configurar execução do projeto");
    expect(m.store.obter().editor).toBe("novo");
  });
});

describe("atalhos globais", () => {
  it("F5 executa; com execução ativa, F5 para; Shift+F5 para; Ctrl+Shift+F5 reinicia (no foco de qualquer lugar)", async () => {
    const m = await montar();
    fireEvent.keyDown(window, { key: "F5", code: "F5" });
    await waitFor(() => expect(m.api.iniciar).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: /^Parar / });
    fireEvent.keyDown(document.body, { key: "F5", code: "F5" });
    await waitFor(() => expect(m.api.parar).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(window, { key: "F5", code: "F5", shiftKey: true });
    await waitFor(() => expect(m.api.parar).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(window, { key: "F5", code: "F5", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(m.api.reiniciar).toHaveBeenCalledTimes(1));
  });

  it("F5 não faz o reload do navegador (preventDefault) e Ctrl+R/letras puras passam", async () => {
    await montar();
    const f5 = new KeyboardEvent("keydown", { key: "F5", code: "F5", bubbles: true, cancelable: true });
    window.dispatchEvent(f5);
    expect(f5.defaultPrevented).toBe(true);
    const ctrlR = new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ctrlR);
    expect(ctrlR.defaultPrevented).toBe(false);
  });
});

describe("cabeçalho compacto", () => {
  it("sem workspace o botão não aparece", async () => {
    const api = { estado: vi.fn(), assinar: vi.fn(() => () => undefined) };
    const store = criarStoreExecutar({ api: () => api as never, workspaces: { obter: () => ({ atual: null }) as never, assinar: () => () => undefined }, ocioso: (f) => f() });
    const { container } = render(<BotaoExecutar store={store} />);
    expect(container.querySelector(".topo-exec")).toBeNull();
  });

  it("configuração com aviso de prechecagem mostra o sinal e o aviso no nome acessível e no tooltip (sem executar nada)", async () => {
    const lista: ListaExecucao = { ...LISTA, configuracoes: [item("dev", "desktop · Rodar (dev)", { padrao: true, avisos: [{ codigo: "sem_node_modules", mensagem: "A pasta de desktop ainda não tem node_modules.", pre_passo: { executavel: "npm", argumentos: ["install"] } }] }), item("test", "Testes", { tipo: "teste" })] };
    const m = await montar(ocioso, lista);
    fireEvent.click(screen.getByRole("button", { name: "Configurações de execução" }));
    const menu = await screen.findByRole("menu", { name: "Configurações de execução" });
    const comAviso = await within(menu).findByRole("menuitem", { name: /Executar desktop · Rodar \(dev\) \(padrão\)\. Atenção: A pasta de desktop ainda não tem node_modules\./ });
    expect(comAviso.getAttribute("title")).toContain("ainda não tem node_modules");
    expect(comAviso.querySelector(".topo-exec-aviso")).not.toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Executar Testes" }).querySelector(".topo-exec-aviso")).toBeNull();
    expect(m.api.iniciar).not.toHaveBeenCalled();
  });
});
