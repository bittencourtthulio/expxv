// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { EventoTerminal, FerramentaDetectada, LayoutTerminais, MetadadosSessao } from "../../../compartilhado/terminais";
import { criarArmazem, type Armazem } from "../../componentes/Terminal/armazem";
import { criarStoreTerminais } from "../../estado/terminais";
import { pedirAcao } from "../../estado/navegacao";
import Tela from "./index";
import type { PropsTerminalGrade } from "./Grade";

const meta = (sessao_id: string): MetadadosSessao => ({ sessao_id, ferramenta_id: "claude", estado: "executando", workspace_id: null, criada_em: "x", persistente: true });
const claude: FerramentaDetectada = { id: "claude", nome: "Claude Code", descricao: "CLI da Anthropic", instalado: true, executavel_id: "e1", modo_lancamento: "direto", erro_codigo: null, versao: "2.0", recursos: { prompt_inicial: true, retomar: true, mcp: true, hook: true } };
const codex: FerramentaDetectada = { ...claude, id: "codex", nome: "Codex", instalado: false, executavel_id: null, erro_codigo: "ausente", versao: null };
const ev = (tipo: EventoTerminal["tipo"], sessao_id: string, sequencia: number, extra: object = {}) => ({ versao: 1, tipo, sessao_id, sequencia, ...extra }) as EventoTerminal;
const T = (sessao_id: string) => ({ tipo: "terminal" as const, sessao_id });
const D = (primeiro: ReturnType<typeof T>, segundo: ReturnType<typeof T>) => ({ tipo: "divisao" as const, orientacao: "vertical" as const, primeiro, segundo });

/** O Terminal real é substituído por um <pre> que assina o MESMO armazém (contrato: replay síncrono + ao vivo). */
function criarTerminalFalso(armazem: Armazem, montagens: string[] = []) {
  return function TerminalFalso({ sessaoId, webgl }: PropsTerminalGrade) {
    const ref = useRef<HTMLPreElement>(null);
    useEffect(() => {
      const el = ref.current!;
      el.textContent = "";
      montagens.push(`+${sessaoId}`);
      const cancelar = armazem.assinar(sessaoId, (c) => { el.textContent += c; });
      return () => { montagens.push(`-${sessaoId}`); cancelar(); };
    }, [sessaoId]);
    return <pre ref={ref} data-testid={`term-${sessaoId}`} data-webgl={webgl} />;
  };
}

function montar(opcoes: { recuperadas?: MetadadosSessao[]; layout?: LayoutTerminais | null; ferramentas?: FerramentaDetectada[]; deteccaoPendente?: boolean } = {}) {
  let ouvir: (e: EventoTerminal) => void = () => undefined;
  let proximo = 1;
  const api = {
    assinarEventos: vi.fn((cb) => { ouvir = cb; return () => undefined; }),
    assinarFalhas: vi.fn(() => () => undefined),
    recuperar: vi.fn().mockResolvedValue({ sessoes: opcoes.recuperadas ?? [] }),
    listarFerramentas: vi.fn(() => (opcoes.deteccaoPendente === true ? new Promise<FerramentaDetectada[]>(() => undefined) : Promise.resolve(opcoes.ferramentas ?? [claude, codex]))),
    abrir: vi.fn(async () => ({ versao: 1, sessao_id: `novo${proximo++}`, estado: "iniciando" })),
    confirmarConsumo: vi.fn().mockResolvedValue(true),
    descartar: vi.fn().mockResolvedValue(true),
    interromper: vi.fn(),
    escrever: vi.fn(),
    redimensionar: vi.fn(),
    lerLayout: vi.fn().mockResolvedValue(opcoes.layout ?? null),
    gravarLayout: vi.fn().mockResolvedValue(true),
  };
  const armazem = criarArmazem();
  const store = criarStoreTerminais({ api: () => api as never, armazem });
  const montagens: string[] = [];
  const Terminal = criarTerminalFalso(armazem, montagens);
  const ui = render(<Tela store={store} api={api as never} Terminal={Terminal} tema="escuro" atrasoGravacao={5} />);
  return { api, armazem, store, montagens, ui, emitir: (e: EventoTerminal) => act(() => ouvir(e)) };
}

describe("Tela de Terminais: estados e abertura", () => {
  it("sem nenhuma CLI instalada explica como instalar e oferece detectar de novo", async () => {
    const { api } = montar({ ferramentas: [{ ...codex }] });
    expect(await screen.findByText("Nenhuma CLI encontrada")).toBeTruthy();
    expect(screen.getByText(/Instale uma CLI de IA/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Detectar de novo" }));
    await waitFor(() => expect(api.listarFerramentas).toHaveBeenCalledWith(true));
  });

  it("escolhe a CLI pela UI, abre a sessão e mostra o painel com rótulo #n · CLI", async () => {
    const { api } = montar();
    expect(await screen.findByText("Nenhum terminal aberto")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Claude Code" }));
    await screen.findByRole("region", { name: "Painel #1 · Claude Code" });
    expect(api.abrir).toHaveBeenCalledWith(expect.objectContaining({ ferramenta_id: "claude", executavel_id: "e1", workspace_id: null }));
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("#1 · Claude Code");
    expect(screen.queryByText("Nenhum terminal aberto")).toBeNull();
  });

  it("pedirAcao('novo-terminal') (paleta) abre uma sessão na CLI padrão, mesmo se pedida antes da detecção terminar", async () => {
    const { api } = montar();
    act(() => pedirAcao("novo-terminal")); // a detecção ainda não voltou: o pedido espera
    await screen.findByRole("region", { name: "Painel #1 · Claude Code" });
    expect(api.abrir).toHaveBeenCalledTimes(1);
    expect(api.abrir).toHaveBeenCalledWith(expect.objectContaining({ ferramenta_id: "claude" }));
    act(() => pedirAcao("novo-terminal"));
    await screen.findByRole("region", { name: "Painel #2 · Claude Code" });
    expect(api.abrir).toHaveBeenCalledTimes(2);
  });

  it("CLI não instalada aparece desabilitada no menu de nova sessão, e erro ao abrir é mostrado", async () => {
    const { api } = montar();
    await screen.findByText("Nenhum terminal aberto");
    fireEvent.click(screen.getByRole("button", { name: /Nova sessão/ }));
    const menu = screen.getByRole("menu");
    expect((within(menu).getByRole("menuitem", { name: /Codex/ }) as HTMLButtonElement).disabled).toBe(true);
    api.abrir.mockRejectedValueOnce(new Error("sem permissão"));
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Claude Code/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("sem permissão");
  });

  it("sem ponte (fora do Electron) mostra estado claro, sem quebrar", async () => {
    const store = criarStoreTerminais({ api: () => undefined, armazem: criarArmazem() });
    render(<Tela store={store} api={undefined} Terminal={criarTerminalFalso(criarArmazem())} tema="escuro" />);
    expect(await screen.findByText("Terminais só funcionam no aplicativo")).toBeTruthy();
  });
});

describe("Tela de Terminais: restauração, desmontagem e saída", () => {
  it("painéis recuperados aparecem sem esperar a detecção de CLIs (P-13)", async () => {
    const layout: LayoutTerminais = { versao: 2, ativa: "a", fixadas: [], abas: [{ arvore: T("a") }] };
    montar({ recuperadas: [meta("a")], layout, deteccaoPendente: true });
    expect(await screen.findByTestId("term-a")).toBeTruthy();
  });

  it("sem sessões, o estado vazio continua esperando a detecção (não pisca 'nenhuma CLI')", async () => {
    montar({ deteccaoPendente: true });
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(screen.queryByText("Nenhuma CLI encontrada")).toBeNull();
  });

  it("restaura sessões que sobreviveram pelo layout gravado, sem duplicar painéis nem saída", async () => {
    const layout: LayoutTerminais = { versao: 2, ativa: "b", fixadas: [], abas: [{ arvore: D(T("a"), T("b")) }] };
    const { armazem, emitir } = montar({ recuperadas: [meta("a"), meta("b"), meta("c")], layout });
    await screen.findByRole("region", { name: "Painel #1 · Claude Code" });
    expect(screen.getAllByRole("region")).toHaveLength(2);
    expect(screen.getAllByRole("tab")).toHaveLength(2); // a+b juntas, c solta
    emitir(ev("saida", "a", 1, { dados: "histórico " }));
    emitir(ev("saida", "a", 1, { dados: "histórico " })); // replay repetido do daemon
    emitir(ev("saida", "a", 2, { dados: "novo" }));
    expect(screen.getByTestId("term-a").textContent).toBe("histórico novo");
    expect(armazem.chunks("a")).toEqual(["histórico ", "novo"]);
  });

  it("painel fora de vista é desmontado e reidratado do armazém com a mesma saída", async () => {
    const layout: LayoutTerminais = { versao: 2, ativa: "a", fixadas: [], abas: [{ arvore: T("a") }, { arvore: T("b") }] };
    const { emitir, montagens } = montar({ recuperadas: [meta("a"), meta("b")], layout });
    await screen.findByTestId("term-a");
    emitir(ev("saida", "a", 1, { dados: "linha 1\n" }));
    emitir(ev("saida", "b", 1, { dados: "da aba b" }));
    expect(screen.queryByTestId("term-b")).toBeNull(); // aba b não está visível: desmontada
    fireEvent.click(screen.getAllByRole("tab")[1]!);
    await screen.findByTestId("term-b");
    expect(screen.queryByTestId("term-a")).toBeNull();
    expect(screen.getByTestId("term-b").textContent).toBe("da aba b"); // reidratado
    emitir(ev("saida", "a", 2, { dados: "linha 2\n" })); // chegou com a aba a desmontada
    fireEvent.click(screen.getAllByRole("tab")[0]!);
    await screen.findByTestId("term-a");
    expect(screen.getByTestId("term-a").textContent).toBe("linha 1\nlinha 2\n");
    expect(montagens).toEqual(["+a", "-a", "+b", "-b", "+a"]);
  });

  it("no máximo 6 painéis pedem WebGL, o em foco sempre entre eles", async () => {
    type No = LayoutTerminais["abas"][0]["arvore"];
    let arvore: No = T("s0");
    for (let i = 1; i < 8; i += 1) arvore = { tipo: "divisao", orientacao: "vertical", primeiro: arvore, segundo: T(`s${i}`) };
    montar({ recuperadas: Array.from({ length: 8 }, (_, i) => meta(`s${i}`)), layout: { versao: 2, ativa: "s7", fixadas: [], abas: [{ arvore }] } });
    await screen.findByTestId("term-s7");
    const com = screen.getAllByTestId(/term-/).filter((p) => p.getAttribute("data-webgl") === "true");
    expect(com.length).toBe(6);
    expect(screen.getByTestId("term-s7").getAttribute("data-webgl")).toBe("true");
  });
});

describe("Tela de Terminais: layout, atalhos e sinaleira", () => {
  it("grava o layout só depois da recuperação; não grava enquanto há abertura em curso", async () => {
    const { api } = montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    await waitFor(() => expect(api.gravarLayout).toHaveBeenCalled());
    const ultimo = api.gravarLayout.mock.calls.at(-1)!;
    expect(ultimo[0]).toBeNull();
    expect(ultimo[1]).toMatchObject({ versao: 2, ativa: "a", abas: [{ arvore: T("a") }] });
  });

  it("não grava nada antes de restaurar (recuperar pendente)", async () => {
    let liberar: (v: unknown) => void = () => undefined;
    const api = {
      assinarEventos: vi.fn(() => () => undefined), assinarFalhas: vi.fn(() => () => undefined),
      recuperar: vi.fn(() => new Promise((r) => { liberar = r; })), listarFerramentas: vi.fn().mockResolvedValue([claude]),
      lerLayout: vi.fn().mockResolvedValue(null), gravarLayout: vi.fn().mockResolvedValue(true), confirmarConsumo: vi.fn(), descartar: vi.fn(), interromper: vi.fn(), escrever: vi.fn(), redimensionar: vi.fn(),
    };
    const store = criarStoreTerminais({ api: () => api as never, armazem: criarArmazem() });
    render(<Tela store={store} api={api as never} Terminal={criarTerminalFalso(criarArmazem())} tema="escuro" atrasoGravacao={1} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(api.gravarLayout).not.toHaveBeenCalled();
    await act(async () => { liberar({ sessoes: [meta("a")] }); await Promise.resolve(); });
    await waitFor(() => expect(api.gravarLayout).toHaveBeenCalled());
  });

  it("atalho de divisão (Ctrl+Shift+D) abre outra sessão da mesma CLI ao lado; Ctrl+D puro não faz nada", async () => {
    const { api } = montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(api.abrir).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "D", ctrlKey: true, shiftKey: true });
    await screen.findByTestId("term-novo1");
    expect(screen.getAllByRole("region")).toHaveLength(2);
    expect(screen.getAllByRole("separator")).toHaveLength(1);
  });

  it("fechar painel chama descartar no main e colapsa a divisão", async () => {
    const layout: LayoutTerminais = { versao: 2, ativa: "a", fixadas: [], abas: [{ arvore: D(T("a"), T("b")) }] };
    const { api } = montar({ recuperadas: [meta("a"), meta("b")], layout });
    await screen.findByTestId("term-b");
    fireEvent.click(screen.getByRole("button", { name: "Fechar #2 · Claude Code" }));
    await waitFor(() => expect(screen.queryByTestId("term-b")).toBeNull());
    expect(api.descartar).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("expandir deixa um painel só montado e restaurar devolve os dois", async () => {
    const layout: LayoutTerminais = { versao: 2, ativa: "a", fixadas: [], abas: [{ arvore: D(T("a"), T("b")) }] };
    montar({ recuperadas: [meta("a"), meta("b")], layout });
    await screen.findByTestId("term-b");
    fireEvent.click(screen.getByRole("button", { name: "Expandir #1 · Claude Code" }));
    expect(screen.queryByTestId("term-b")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restaurar #1 · Claude Code" }));
    expect(await screen.findByTestId("term-b")).toBeTruthy();
  });

  it("sinaleira: aguardando aparece com forma e aria-label (não só cor), agrega por aba e alimenta o contador", async () => {
    const layout: LayoutTerminais = { versao: 2, ativa: "a", fixadas: [], abas: [{ arvore: D(T("a"), T("b")) }] };
    const { emitir } = montar({ recuperadas: [meta("a"), meta("b")], layout });
    await screen.findByTestId("term-b");
    emitir(ev("atividade", "a", 1, { atividade: "trabalhando" }));
    emitir(ev("atividade", "b", 1, { atividade: "aguardando" }));
    const aba = screen.getByRole("tab");
    expect(within(aba).getByRole("img", { name: "aguardando você" }).textContent).toBe("!"); // aguardando > trabalhando
    expect(screen.getByRole("button", { name: /1 aguardando você/ })).toBeTruthy();
    emitir(ev("atividade", "b", 2, { atividade: "pronto" }));
    expect(within(screen.getByRole("tab")).getByRole("img", { name: "trabalhando" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /aguardando você/ })).toBeNull();
  });

  it("sessão encerrada mostra o estado e oferece fechar o painel", async () => {
    const { emitir } = montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    emitir(ev("encerramento", "a", 1, { codigo: 2, sinal: null }));
    expect((await screen.findByRole("status", { name: "" })).textContent).toContain("Sessão encerrada (código 2)");
  });

  it("a ajuda de atalhos é um diálogo que o Esc fecha", async () => {
    montar({ recuperadas: [meta("a")] });
    await screen.findByTestId("term-a");
    fireEvent.click(screen.getByRole("button", { name: "Atalhos de teclado" }));
    expect(screen.getByRole("dialog", { name: "Atalhos de teclado" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
