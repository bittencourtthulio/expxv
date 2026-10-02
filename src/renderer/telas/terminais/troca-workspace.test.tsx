// @vitest-environment jsdom
// D-570/D-571/P-570: a tela Terminais mostra SÓ os terminais do workspace atual; cada workspace lembra o próprio estado; os outros seguem vivos (armazém acumula, sem xterm montado).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventoTerminal, FerramentaDetectada, LayoutTerminais, MetadadosSessao } from "../../../compartilhado/terminais";
import { criarArmazem, type Armazem } from "../../componentes/Terminal/armazem";
import { pedirFocoSessao } from "../../estado/navegacao";
import { criarStoreTerminais } from "../../estado/terminais";
import { criarStoreVisaoTerminais } from "../../estado/terminais-visao";
import { storeWorkspaces } from "../../estado/workspaces";
import Tela from "./index";
import type { PropsTerminalGrade } from "./Grade";

const meta = (sessao_id: string, workspace_id: string | null): MetadadosSessao => ({ sessao_id, ferramenta_id: "claude", estado: "executando", workspace_id, criada_em: "x", persistente: true });
const claude: FerramentaDetectada = { id: "claude", nome: "Claude Code", descricao: "", instalado: true, executavel_id: "e1", modo_lancamento: "direto", erro_codigo: null, versao: "2.0", recursos: { prompt_inicial: true, retomar: true, mcp: true, hook: true } };
const ev = (tipo: EventoTerminal["tipo"], sessao_id: string, sequencia: number, extra: object = {}) => ({ versao: 1, tipo, sessao_id, sequencia, ...extra }) as EventoTerminal;

function criarTerminalFalso(armazem: Armazem, montagens: string[]) {
  return function TerminalFalso({ sessaoId }: PropsTerminalGrade) {
    const ref = useRef<HTMLPreElement>(null);
    useEffect(() => {
      const el = ref.current!;
      el.textContent = "";
      montagens.push(`+${sessaoId}`);
      const cancelar = armazem.assinar(sessaoId, (c) => { el.textContent += c; });
      return () => { montagens.push(`-${sessaoId}`); cancelar(); };
    }, [sessaoId]);
    return <pre ref={ref} data-testid={`term-${sessaoId}`} />;
  };
}

const SESSOES = [
  meta("a1", "A"), meta("a2", "A"),
  meta("b1", "B"), meta("b2", "B"), meta("b3", "B"),
  meta("c1", "C"),
];

function montar(opcoes: { sessoes?: MetadadosSessao[]; ws?: string | null; layouts?: Record<string, LayoutTerminais>; semProjeto?: boolean } = {}) {
  let ouvir: (e: EventoTerminal) => void = () => undefined;
  let proximo = 1;
  const api = {
    assinarEventos: vi.fn((cb) => { ouvir = cb; return () => undefined; }),
    assinarFalhas: vi.fn(() => () => undefined),
    recuperar: vi.fn().mockResolvedValue({ sessoes: opcoes.sessoes ?? SESSOES }),
    listarFerramentas: vi.fn().mockResolvedValue([claude]),
    abrir: vi.fn(async () => ({ versao: 1, sessao_id: `novo${proximo++}`, estado: "iniciando" })),
    confirmarConsumo: vi.fn().mockResolvedValue(true), descartar: vi.fn().mockResolvedValue(true), interromper: vi.fn(), escrever: vi.fn(), redimensionar: vi.fn(),
    lerLayout: vi.fn(async (c: string | null) => opcoes.layouts?.[String(c)] ?? null),
    gravarLayout: vi.fn().mockResolvedValue(true),
  };
  const armazem = criarArmazem();
  const store = criarStoreTerminais({ api: () => api as never, armazem });
  const montagens: string[] = [];
  const visao = criarStoreVisaoTerminais();
  if (opcoes.semProjeto === true) visao.entrarEmSemProjeto(); // pedido feito de OUTRA tela, antes de a Tela montar
  const Terminal = criarTerminalFalso(armazem, montagens);
  const tela = (ws: string | null) => <Tela store={store} api={api as never} Terminal={Terminal} tema="escuro" atrasoGravacao={5} infoMissao={{}} workspaceId={ws} visao={visao} />;
  const ui = render(tela(opcoes.ws === undefined ? "A" : opcoes.ws));
  return { api, armazem, store, montagens, visao, ui, ir: (ws: string | null) => ui.rerender(tela(ws)), emitir: (e: EventoTerminal) => act(() => ouvir(e)) };
}

const abrirNovo = (): void => {
  fireEvent.click(screen.getByRole("button", { name: /Nova sessão/ }));
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /Claude Code/ }));
};
const painelsNaTela = (): string[] => [...document.querySelectorAll<HTMLElement>("[data-sessao]")].map((e) => e.dataset["sessao"]!);
const abasNaTela = (): string[] => screen.queryAllByRole("tab").map((t) => t.textContent ?? "");

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("troca de workspace: só os terminais do workspace atual", () => {
  it("A mostra só a1 e a2; trocar para B mostra só b1, b2 e b3; C mostra só c1 (abas e painéis)", async () => {
    const m = montar();
    await screen.findByTestId("term-a1");
    expect(abasNaTela()).toHaveLength(2);
    expect(screen.queryByTestId("term-b1")).toBeNull();
    m.ir("B");
    await screen.findByRole("tab", { selected: true });
    expect(abasNaTela()).toHaveLength(3);
    expect(painelsNaTela()).toEqual(["b1"]); // só a aba ativa é montada
    expect(screen.queryByTestId("term-a1")).toBeNull();
    m.ir("C");
    expect(abasNaTela()).toHaveLength(1);
    expect(painelsNaTela()).toEqual(["c1"]);
    expect(screen.queryByText(/Sem projeto/)).toBeNull();
  });

  it("os terminais do workspace que sai são DESMONTADOS (nada de xterm/WebGL oculto) e remontam ao voltar", async () => {
    const m = montar();
    await screen.findByTestId("term-a1");
    m.ir("B");
    await screen.findByTestId("term-b1");
    expect(m.montagens).toContain("-a1");
    expect(m.montagens.filter((x) => x === "+a1")).toHaveLength(1);
    m.ir("A");
    await screen.findByTestId("term-a1");
    expect(m.montagens.filter((x) => x === "+a1")).toHaveLength(2);
    expect(m.montagens).toContain("-b1");
  });

  it("voltar a A restaura o layout (divisão), o painel em foco e o painel expandido; B mantém a aba que tinha", async () => {
    const T = (sessao_id: string) => ({ tipo: "terminal" as const, sessao_id });
    const layouts = { A: { versao: 2, ativa: "a1", fixadas: [], abas: [{ arvore: { tipo: "divisao", orientacao: "vertical", primeiro: T("a1"), segundo: T("a2") } }] } as LayoutTerminais };
    const m = montar({ layouts });
    await waitFor(() => expect(painelsNaTela()).toEqual(["a1", "a2"]));
    // foco em a2 (clique no painel) e depois expande o a2
    fireEvent.pointerDown(document.querySelector('[data-sessao="a2"]')!);
    await waitFor(() => expect(document.querySelector('[data-sessao="a2"]')!.getAttribute("data-foco")).not.toBeNull());
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-sessao="a2"]')!).getByRole("button", { name: /^Expandir/ }));
    await waitFor(() => expect(painelsNaTela()).toEqual(["a2"]));

    m.ir("B");
    await waitFor(() => expect(painelsNaTela()).toEqual(["b1"]));
    fireEvent.click(screen.getAllByRole("tab")[2]!); // b3
    await waitFor(() => expect(painelsNaTela()).toEqual(["b3"]));

    m.ir("A");
    expect(painelsNaTela()).toEqual(["a2"]); // expandido, foco no a2: no mesmo quadro, sem esperar nada
    expect(document.querySelector('[data-sessao="a2"]')!.getAttribute("data-foco")).not.toBeNull();
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-sessao="a2"]')!).getByRole("button", { name: /^Restaurar/ }));
    await waitFor(() => expect(painelsNaTela()).toEqual(["a1", "a2"]));

    m.ir("B");
    expect(painelsNaTela()).toEqual(["b3"]);
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("#5");
  });

  it("a proporção do divisor arrastado é lembrada por workspace", async () => {
    const T = (sessao_id: string) => ({ tipo: "terminal" as const, sessao_id });
    const layouts = { A: { versao: 2, ativa: "a1", fixadas: [], abas: [{ arvore: { tipo: "divisao", orientacao: "vertical", primeiro: T("a1"), segundo: T("a2") } }] } as LayoutTerminais };
    const m = montar({ layouts });
    await waitFor(() => expect(painelsNaTela()).toEqual(["a1", "a2"]));
    const sep = () => screen.getByRole("separator", { name: "Redimensionar painéis" });
    expect(sep().getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(sep(), { key: "ArrowRight" });
    expect(sep().getAttribute("aria-valuenow")).toBe("55");
    m.ir("B");
    await waitFor(() => expect(painelsNaTela()).toEqual(["b1"]));
    m.ir("A");
    expect(sep().getAttribute("aria-valuenow")).toBe("55");
    // e vai para o disco do workspace A (e só dele)
    await waitFor(() => expect(m.api.gravarLayout).toHaveBeenCalledWith("A", expect.objectContaining({ abas: [{ arvore: expect.objectContaining({ proporcao: 0.55 }) }] })));
  });

  it("nunca grava layout de um workspace com sessão de outro", async () => {
    const m = montar();
    await screen.findByTestId("term-a1");
    m.ir("B");
    await screen.findByTestId("term-b1");
    m.ir("A");
    await screen.findByTestId("term-a1");
    await waitFor(() => expect(m.api.gravarLayout).toHaveBeenCalledWith("B", expect.anything()));
    const donos = new Map([["A", ["a1", "a2"]], ["B", ["b1", "b2", "b3"]]]);
    const ids = (no: { tipo: string; sessao_id?: string; primeiro?: unknown; segundo?: unknown }): string[] => (no.tipo === "terminal" ? [no.sessao_id!] : [...ids(no.primeiro as never), ...ids(no.segundo as never)]);
    for (const [ws, layout] of m.api.gravarLayout.mock.calls as unknown as Array<[string, LayoutTerminais]>) {
      for (const aba of layout.abas) for (const id of ids(aba.arvore)) expect(donos.get(ws)).toContain(id);
    }
  });

  it("primeira visita a um workspace aplica o layout dele do disco; sem layout, abas por sessão; o layout antigo (único) serve de base podado", async () => {
    const T = (sessao_id: string) => ({ tipo: "terminal" as const, sessao_id });
    const legado: LayoutTerminais = { versao: 2, ativa: "b2", fixadas: [], abas: [{ arvore: { tipo: "divisao", orientacao: "horizontal", primeiro: T("a1"), segundo: T("b2") } }, { arvore: T("b1") }] };
    const m = montar({ layouts: { null: legado } });
    await screen.findByTestId("term-a1");
    m.ir("B");
    // o legado podado a B: b2 e b1 em abas separadas, b3 sobrando como aba
    await waitFor(() => expect(m.api.lerLayout).toHaveBeenCalledWith("B"));
    await waitFor(() => expect(screen.getByRole("tab", { selected: true }).textContent).toContain("#4"));
    expect(abasNaTela()).toHaveLength(3);
  });

  it("sessão nova entra só no workspace atual (e grava o workspace de origem); em A ela não aparece", async () => {
    const m = montar({ ws: "B" });
    await screen.findByTestId("term-b1");
    abrirNovo();
    await waitFor(() => expect(m.api.abrir).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "B" })));
    await waitFor(() => expect(abasNaTela()).toHaveLength(4));
    m.ir("A");
    expect(abasNaTela()).toHaveLength(2);
    expect(m.store.obter().sessoes.find((x) => x.sessao_id === "novo1")?.workspace_id).toBe("B");
    m.ir("B");
    expect(abasNaTela()).toHaveLength(4);
  });

  it("sessão aberta quando a pessoa já trocou de workspace fica no workspace de origem e entra na grade dele ao voltar", async () => {
    const m = montar({ ws: "B" });
    await screen.findByTestId("term-b1");
    let soltar: (v: { versao: 1; sessao_id: string; estado: "iniciando" }) => void = () => undefined;
    m.api.abrir.mockImplementationOnce(() => new Promise((r) => { soltar = r as never; }));
    abrirNovo();
    await waitFor(() => expect(m.api.abrir).toHaveBeenCalled());
    m.ir("A");
    await waitFor(() => expect(painelsNaTela()).toEqual(["a1"]));
    await act(async () => { soltar({ versao: 1, sessao_id: "tardia", estado: "iniciando" }); });
    expect(abasNaTela()).toHaveLength(2); // A continua só com os dela
    m.ir("B");
    expect(abasNaTela()).toHaveLength(4); // a tardia entrou em B como aba
  });
});

describe("terminais sem projeto (D-571)", () => {
  it("o grupo só aparece quando existem sessões sem workspace; aberto, rotulado, nunca misturado, sem abrir terminal novo", async () => {
    const m = montar({ sessoes: [...SESSOES, meta("n1", null)] });
    await screen.findByTestId("term-a1");
    expect(screen.queryByTestId("grupo-sem-projeto")).toBeNull();
    expect(screen.queryByTestId("term-n1")).toBeNull();
    act(() => m.visao.entrarEmSemProjeto());
    await screen.findByTestId("grupo-sem-projeto");
    expect(painelsNaTela()).toEqual(["n1"]);
    expect(screen.getByTestId("grupo-sem-projeto").textContent).toContain("Sem projeto");
    // terminal novo ficaria no workspace atual e se misturaria: a barra bloqueia
    expect((screen.getByRole("button", { name: /Nova sessão/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(screen.getByTestId("grupo-sem-projeto")).getByRole("button", { name: /Voltar a/ }));
    await waitFor(() => expect(painelsNaTela()).toEqual(["a1"]));
    expect(screen.queryByTestId("grupo-sem-projeto")).toBeNull();
  });

  it("'Sem projeto (N)' pedido de outra tela (a Tela ainda nem montou) vale ao montar", async () => {
    const m = montar({ sessoes: [...SESSOES, meta("n1", null)], semProjeto: true });
    await screen.findByTestId("grupo-sem-projeto");
    expect(painelsNaTela()).toEqual(["n1"]);
    expect(m.visao.obter()).toBe(true);
    // mudar o workspace atual, aí sim, sai do grupo
    m.ir("B");
    await waitFor(() => expect(m.visao.obter()).toBe(false));
    await waitFor(() => expect(painelsNaTela()).toEqual(["b1"]));
  });

  it("sem sessões null o pedido de 'Sem projeto' não esconde nada: ao esvaziar o grupo, volta ao workspace", async () => {
    const m = montar({ sessoes: [...SESSOES, meta("n1", null)] });
    await screen.findByTestId("term-a1");
    act(() => m.visao.entrarEmSemProjeto());
    await screen.findByTestId("term-n1");
    act(() => m.store.fechar("n1"));
    await waitFor(() => expect(m.visao.obter()).toBe(false));
    await waitFor(() => expect(painelsNaTela()).toEqual(["a1"]));
  });
});

describe("saída dos workspaces ocultos e foco", () => {
  it("a saída de um terminal oculto vai ao armazém e é reproduzida (replay) ao voltar, sem mexer na tela atual", async () => {
    const m = montar();
    await screen.findByTestId("term-a1");
    const antes = painelsNaTela();
    m.emitir(ev("saida", "b1", 1, { dados: "feito em segundo plano" }));
    m.emitir(ev("saida", "b1", 2, { dados: " e mais" }));
    expect(painelsNaTela()).toEqual(antes);
    expect(m.armazem.assinantes("b1")).toBe(0);
    expect(m.api.confirmarConsumo).toHaveBeenCalledWith("b1", expect.any(Number)); // ninguém monta: o consumo é confirmado, o PTY não emperra
    m.ir("B");
    expect((await screen.findByTestId("term-b1")).textContent).toBe("feito em segundo plano e mais");
  });

  it("pedido de foco de uma sessão de OUTRO workspace (painel de workspaces, ⌘K) troca de workspace; com a troca feita, foca o painel certo", async () => {
    const troca = vi.spyOn(storeWorkspaces, "definirAtual").mockResolvedValue(undefined);
    const m = montar();
    await screen.findByTestId("term-a1");
    act(() => pedirFocoSessao("b2"));
    await waitFor(() => expect(troca).toHaveBeenCalledWith("B"));
    m.ir("B"); // o main confirmou o workspace
    await waitFor(() => expect(painelsNaTela()).toEqual(["b2"]));
    expect(document.querySelector('[data-sessao="b2"]')!.getAttribute("data-foco")).not.toBeNull();
  });

  it("atalhos de painel operam só no conjunto do workspace atual (próxima aba em B nunca cai em A)", async () => {
    const m = montar({ ws: "B" });
    await screen.findByTestId("term-b1");
    const visto = new Set<string>();
    for (let i = 0; i < 4; i++) {
      fireEvent.keyDown(window, { key: "Tab", code: "Tab", ctrlKey: true });
      painelsNaTela().forEach((id) => visto.add(id));
    }
    expect([...visto].sort()).toEqual(["b1", "b2", "b3"]); // deu a volta nas 3 abas de B e nunca caiu em A
    m.ir("A");
    expect(painelsNaTela().every((id) => id.startsWith("a"))).toBe(true);
  });
});

describe("P-570: a troca de workspace com 6 terminais leva ≤ 100 ms", () => {
  it("mede a troca A→B (6 painéis cada, tudo em uma aba) e a volta; registra os tempos", async () => {
    const T = (sessao_id: string) => ({ tipo: "terminal" as const, sessao_id });
    const grade = (p: string) => ({ abas: [{ arvore: { tipo: "divisao" as const, orientacao: "vertical" as const, primeiro: { tipo: "divisao" as const, orientacao: "horizontal" as const, primeiro: T(`${p}1`), segundo: { tipo: "divisao" as const, orientacao: "horizontal" as const, primeiro: T(`${p}2`), segundo: T(`${p}3`) } }, segundo: { tipo: "divisao" as const, orientacao: "horizontal" as const, primeiro: T(`${p}4`), segundo: { tipo: "divisao" as const, orientacao: "horizontal" as const, primeiro: T(`${p}5`), segundo: T(`${p}6`) } } } }] });
    const sessoes = ["a", "b"].flatMap((p) => [1, 2, 3, 4, 5, 6].map((n) => meta(`${p}${n}`, p.toUpperCase())));
    const layouts = { A: { versao: 2 as const, ativa: "a1", fixadas: [], ...grade("a") }, B: { versao: 2 as const, ativa: "b1", fixadas: [], ...grade("b") } };
    const m = montar({ sessoes, layouts: layouts as never });
    await waitFor(() => expect(painelsNaTela()).toHaveLength(6));
    // enche o armazém de B (saída oculta) para o replay entrar na conta
    for (let n = 1; n <= 6; n++) for (let i = 1; i <= 50; i++) m.emitir(ev("saida", `b${n}`, i, { dados: "x".repeat(200) }));
    m.ir("B"); // primeira visita: aquece o layout do disco
    await waitFor(() => expect(painelsNaTela()).toHaveLength(6));
    const tempos: number[] = [];
    for (let k = 0; k < 6; k++) {
      const alvo = k % 2 === 0 ? "A" : "B";
      const t0 = performance.now();
      m.ir(alvo);
      expect(painelsNaTela()).toHaveLength(6); // já no mesmo quadro: sem esperar nada
      tempos.push(performance.now() - t0);
    }
    const mediana = [...tempos].sort((a, b) => a - b)[Math.floor(tempos.length / 2)]!;
    console.info(`[P-570] troca de workspace com 6 terminais (jsdom, terminal falso): mediana ${mediana.toFixed(1)} ms, pior ${Math.max(...tempos).toFixed(1)} ms`);
    expect(Math.max(...tempos)).toBeLessThanOrEqual(100);
  });
});
