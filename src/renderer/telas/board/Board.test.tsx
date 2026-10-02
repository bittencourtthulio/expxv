// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardModelo, CardBoard } from "../../../compartilhado/custo";
import { custoFalso } from "../../a11y/ade-falso-custo";
import { ws } from "../../a11y/ade-falso";
import { formatar, varrer } from "../../a11y/varredura";
import { criarStoreBoard } from "../../estado/board";
import type { ArmazemLike } from "../../estado/board-filtros";
import { criarStoreWorkspaces } from "../../estado/workspaces";
import { contadorRenders } from "./CardLinha";
import { cardFalso, detalheFalso, modeloFalso, resumoCusto } from "./fabrica-teste";
import { TelaBoard } from "./index";

afterEach(() => { cleanup(); delete (globalThis as { ade?: unknown }).ade; });

const armazem = (): ArmazemLike & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };

async function montar(snapshot: (f: unknown) => Promise<BoardModelo> | BoardModelo, extra: Record<string, unknown> = {}) {
  const base = custoFalso();
  const board = { ...base.board, snapshot: vi.fn(async (f: unknown) => snapshot(f)), ...extra };
  (globalThis as unknown as { ade: unknown }).ade = { custo: base.custo, board, harness: {}, metodo: { comandoSugerido: async () => ({ comando: "/expx:sprintx", pane_separado: false, somente_humano: false, motivo_bloqueio: null }) } };
  const arm = armazem();
  const store = criarStoreBoard({ api: () => board as never, armazem: arm });
  const workspaces = criarStoreWorkspaces({ api: () => ({ estado: async () => ({ atual: ws("w1"), recentes: [ws("w1")] }), assinar: () => () => undefined }) as never });
  await workspaces.iniciar();
  await act(async () => { render(<TelaBoard store={store} workspaces={workspaces} atrasoBusca={0} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { board, store, arm };
}

const cinco = (): CardBoard[] => [
  cardFalso(1, { coluna: "validado", custo: { usd: 2.4, incompleto: false, aproximado: false } }),
  cardFalso(2, { coluna: "concluido", custo: { usd: 1.8, incompleto: true, aproximado: false } }),
  cardFalso(3, { coluna: "em_andamento", selos: ["pronta"], executor: { pane_id: "p1", cli: "claude", modelo: "claude-sonnet", conta_rotulo: "pessoal" }, custo: { usd: 0.42, incompleto: false, aproximado: true } }),
  cardFalso(4, { coluna: "a_fazer", selos: ["pronta"] }),
  cardFalso(5, { coluna: "backlog", depende_de: ["T-04"] }),
];

describe("Board: colunas e cards", () => {
  it("seis colunas role=region com contagem; card anuncia id, coluna, selos e custo com ≥/≈/desconhecido", async () => {
    await montar(() => modeloFalso(cinco()));
    for (const nome of [/^Backlog, 1 card/, /^A fazer, 1 card/, /^Em andamento, 1 card/, /^Em revisão, 0 cards/, /^Concluído, 1 card/, /^Validado, 1 card/]) expect(screen.getByRole("region", { name: nome })).toBeTruthy();
    expect(screen.getByRole("article", { name: "T-03, em andamento, pronta, ≈ US$ 0,42" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "T-02, concluído, ≥ US$ 1,80" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "T-05, backlog, custo desconhecido" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/US\$ 0,00/);
    expect(screen.getByRole("toolbar", { name: "Controles do board" })).toBeTruthy();
  });

  it("sem arrastar: nenhum card é draggable", async () => {
    await montar(() => modeloFalso(cinco()));
    expect(document.querySelectorAll("[draggable=true]")).toHaveLength(0);
  });

  it("estados: vazio (próximo passo), erro (tentar de novo), carregando e indisponível", async () => {
    await montar(() => modeloFalso([]));
    expect(screen.getByText(/Nenhum plano do método neste workspace/)).toBeTruthy();
    expect(screen.getByText(/\/expx:sprintx/)).toBeTruthy();
    cleanup();
    const r = await montar(() => { throw new Error("falha"); });
    expect(screen.getByRole("alert").textContent).toMatch(/falha/);
    r.board.snapshot.mockImplementation(async () => modeloFalso(cinco()));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" })); });
    expect(screen.getByRole("region", { name: /^Validado/ })).toBeTruthy();
    cleanup();
    await act(async () => { render(<TelaBoard store={criarStoreBoard({ api: () => undefined, armazem: armazem() })} workspaces={criarStoreWorkspaces({ api: () => ({ estado: async () => ({ atual: ws("w1"), recentes: [] }), assinar: () => () => undefined }) as never })} />); });
  });

  it("detalhe: abre como complementary, mostra custo por modelo, Esc fecha e devolve o foco ao card", async () => {
    await montar(() => modeloFalso(cinco()));
    const botao = screen.getByRole("article", { name: /^T-03/ });
    botao.focus();
    await act(async () => { fireEvent.click(botao); });
    const det = await screen.findByRole("complementary", { name: "Detalhe de T-03" });
    await within(det).findByText("Fazer o login");
    expect(within(det).getByRole("list", { name: "Custo por modelo" }).textContent).toContain("claude-sonnet");
    expect(within(det).getByText(/Entra com e-mail/)).toBeTruthy();
    expect(det.textContent).not.toMatch(/\/Users\/|[A-Z]:\\/);
    await act(async () => { fireEvent.keyDown(det, { key: "Escape" }); });
    expect(screen.queryByRole("complementary")).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(document.activeElement).toBe(botao);
  });

  it("detalhe: custo sem preço mostra 'custo desconhecido' por modelo; descartado preserva o custo", async () => {
    const c7 = cardFalso(7, { coluna: "concluido", selos: ["descartada"], custo: { usd: null, incompleto: false, aproximado: false } });
    await montar(() => modeloFalso([c7]), { cardDetalhe: async () => detalheFalso(c7) });
    await act(async () => { fireEvent.click(screen.getByRole("article", { name: /^T-07/ })); });
    const det = await screen.findByRole("complementary");
    await within(det).findByText("Fazer o login");
    expect(within(det).getAllByText("custo desconhecido").length).toBeGreaterThan(0);
    expect(det.textContent).toContain("custo preservado");
  });

  it("filtros: busca vai ao snapshot, persiste por workspace e limpar restaura", async () => {
    const { board, arm } = await montar(() => modeloFalso(cinco()));
    const busca = screen.getByRole("searchbox", { name: "Buscar por id ou título" });
    await act(async () => { fireEvent.change(busca, { target: { value: "login" } }); await new Promise((r) => setTimeout(r, 5)); });
    expect(board.snapshot.mock.calls.at(-1)![0]).toMatchObject({ busca: "login", workspace_id: "w1" });
    expect(arm.m.get("board.filtros.w1")).toContain("login");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" })); await new Promise((r) => setTimeout(r, 5)); });
    expect(arm.m.size).toBe(0);
  });

  it("filtros: multi-trabalho e coluna chegam ao snapshot", async () => {
    const { board } = await montar(() => modeloFalso(cinco()));
    await act(async () => { fireEvent.click(screen.getByText(/^Trabalho/)); });
    await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: "Login" })); await new Promise((r) => setTimeout(r, 5)); });
    expect(board.snapshot.mock.calls.at(-1)![0]).toMatchObject({ trabalho_ids: ["t1"] });
    await act(async () => { fireEvent.click(screen.getByText(/^Filtros/)); });
    await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: "A fazer" })); await new Promise((r) => setTimeout(r, 5)); });
    expect(board.snapshot.mock.calls.at(-1)![0]).toMatchObject({ colunas: ["a_fazer"] });
  });

  it("setas movem o foco entre cards e colunas", async () => {
    await montar(() => modeloFalso([cardFalso(1, { coluna: "a_fazer" }), cardFalso(2, { coluna: "a_fazer" }), cardFalso(3, { coluna: "concluido" })]));
    const b = (n: string) => screen.getByRole("article", { name: new RegExp(`^${n}`) });
    b("T-01").focus();
    await act(async () => { fireEvent.keyDown(b("T-01"), { key: "ArrowDown" }); });
    expect(document.activeElement).toBe(b("T-02"));
    await act(async () => { fireEvent.keyDown(b("T-02"), { key: "ArrowRight" }); });
    expect(document.activeElement).toBe(b("T-03"));
    await act(async () => { fireEvent.keyDown(b("T-03"), { key: "ArrowLeft" }); });
    expect((document.activeElement as HTMLElement).closest("[data-coluna]")?.getAttribute("data-coluna")).toBe("a_fazer");
  });

  it("aria-live: 'custo atualizado' no máximo 1 vez a cada 10 s", async () => {
    let t = 1_000_000;
    let usd = 1;
    const base = custoFalso();
    const board = { ...base.board, snapshot: vi.fn(async () => modeloFalso(cinco(), { custo: resumoCusto(usd) })) };
    (globalThis as unknown as { ade: unknown }).ade = { custo: base.custo, board };
    const store = criarStoreBoard({ api: () => board as never, armazem: armazem() });
    const workspaces = criarStoreWorkspaces({ api: () => ({ estado: async () => ({ atual: ws("w1"), recentes: [] }), assinar: () => () => undefined }) as never });
    await workspaces.iniciar();
    await act(async () => { render(<TelaBoard store={store} workspaces={workspaces} agora={() => t} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const mudar = async (v: number, dt: number) => { usd = v; t += dt; await act(async () => { await store.recarregar(); }); };
    await mudar(2, 20_000);
    expect(screen.getByText(/^Custo atualizado: US\$ 2,00/)).toBeTruthy();
    await mudar(3, 2_000);
    expect(screen.getByText(/^Custo atualizado: US\$ 2,00/)).toBeTruthy(); // não anuncia de novo dentro de 10 s
    await mudar(4, 11_000);
    expect(screen.getByText(/^Custo atualizado: US\$ 4,00/)).toBeTruthy();
  });

  it("varredura de acessibilidade do board, do detalhe e do diálogo de delegar", async () => {
    await montar(() => modeloFalso(cinco()));
    expect(formatar(varrer(document.body))).toBe("");
    await act(async () => { fireEvent.click(screen.getByRole("article", { name: /^T-04/ })); });
    const det = await screen.findByRole("complementary");
    await within(det).findByText("Fazer o login");
    expect(formatar(varrer(document.body))).toBe("");
    await act(async () => { fireEvent.click(within(det).getByRole("button", { name: "Delegar" })); });
    await screen.findByRole("dialog", { name: /Delegar T-04/ });
    expect(formatar(varrer(document.body))).toBe("");
  });
});

describe("Board: delegar card", () => {
  it("mostra estimativa 'sem histórico', exige Confirmar e mostra o recibo; sem confirmar não há efeito", async () => {
    const { board } = await montar(() => modeloFalso(cinco()));
    const delegar = vi.fn(async (p: { task_id: string }) => ({ pane_id: "p9", task_ref: p.task_id, recibo: "rota X" }));
    (globalThis as unknown as { ade: { board: Record<string, unknown> } }).ade.board["delegarCard"] = delegar;
    await act(async () => { fireEvent.click(screen.getByRole("article", { name: /^T-04/ })); });
    const det = await screen.findByRole("complementary");
    await within(det).findByText("Fazer o login");
    await act(async () => { fireEvent.click(within(det).getByRole("button", { name: "Delegar" })); });
    const dlg = await screen.findByRole("dialog", { name: /Delegar T-04/ });
    await within(dlg).findByText(/sem histórico \(1 amostra/);
    await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Cancelar" })); });
    expect(delegar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(det).getByRole("button", { name: "Delegar" })); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Confirmar" })); });
    expect(delegar).toHaveBeenCalledWith({ workspace_id: "w1", mission_id: "m1", trabalho_id: "t1", task_id: "T-04", confirmar: true });
    expect(await screen.findByText(/Recibo: rota X/)).toBeTruthy();
    expect(board.snapshot.mock.calls.length).toBeGreaterThan(1);
  });
  it("conflito (já delegado) vira mensagem clara", async () => {
    await montar(() => modeloFalso(cinco()));
    (globalThis as unknown as { ade: { board: Record<string, unknown> } }).ade.board["delegarCard"] = async () => { throw new Error("conflict.already_delegated: o card já foi delegado"); };
    await act(async () => { fireEvent.click(screen.getByRole("article", { name: /^T-04/ })); });
    const det = await screen.findByRole("complementary");
    await within(det).findByText("Fazer o login");
    await act(async () => { fireEvent.click(within(det).getByRole("button", { name: "Delegar" })); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Confirmar" })); });
    expect((await screen.findByRole("alert")).textContent).toMatch(/já foi delegado/);
  });
  it("card que não está pronto não oferece Delegar", async () => {
    await montar(() => modeloFalso(cinco()));
    await act(async () => { fireEvent.click(screen.getByRole("article", { name: /^T-05/ })); });
    const det = await screen.findByRole("complementary");
    await within(det).findByText("Fazer o login");
    expect(within(det).queryByRole("button", { name: "Delegar" })).toBeNull();
  });
});

describe("Board: P-116 em jsdom (1 000 cards)", () => {
  const mil = (): CardBoard[] => Array.from({ length: 1000 }, (_, i) => cardFalso(i + 1, { coluna: (["backlog", "a_fazer", "em_andamento", "em_revisao", "concluido", "validado"] as const)[i % 6]!, titulo: `Tarefa ${i + 1}`, custo: { usd: i % 7 === 0 ? null : i / 10, incompleto: i % 5 === 0, aproximado: false } }));
  beforeEach(() => { contadorRenders.cards = 0; });

  it("1ª renderização só põe a janela visível no DOM e atualizar 1 card re-renderiza só ele", async () => {
    const lista = mil();
    let atual = lista;
    const t0 = performance.now();
    const { store } = await montar(() => modeloFalso(atual));
    const primeira = performance.now() - t0;
    const cardsNoDom = document.querySelectorAll("[role=article]").length;
    const elementos = document.querySelectorAll(".board *").length;
    // eslint-disable-next-line no-console
    console.log(`P-116 jsdom: 1ª abertura ${primeira.toFixed(0)} ms (inclui montagem do teste), cards no DOM ${cardsNoDom}, elementos ${elementos}`);
    expect(cardsNoDom).toBeLessThan(200);
    // P-116 (decisão do dono): a unidade é ELEMENTO DO DOM, não card; 1 000 cards ficam em ≤ 200 elementos (card = 1 elemento) e a 1ª abertura em ≤ 200 ms
    expect(elementos, `elementos no DOM: ${elementos} (cards ${cardsNoDom})`).toBeLessThanOrEqual(200);
    expect(primeira, `1ª abertura ${primeira.toFixed(0)} ms`).toBeLessThanOrEqual(200);
    expect(cardsNoDom).toBeGreaterThan(0);
    const antes = contadorRenders.cards;
    // muda o custo de UM card visível (T-01 está na 1ª coluna, no topo)
    atual = lista.map((c) => (c.task_id === "T-01" ? { ...c, custo: { usd: 9.99, incompleto: false, aproximado: false } } : c));
    await act(async () => { await store.recarregar(); });
    expect(contadorRenders.cards - antes).toBe(1);
    expect(screen.getByRole("article", { name: /^T-01,.*US\$ 9,99/ })).toBeTruthy();
  });

  it("P-116: com a janela medida (560 px de coluna) 1 000 cards continuam em ≤ 200 elementos", async () => {
    const orig = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 560 });
    try {
      await montar(() => modeloFalso(mil()));
      const elementos = document.querySelectorAll(".board *").length;
      expect(elementos, `elementos no DOM: ${elementos}`).toBeLessThanOrEqual(200);
    } finally {
      if (orig !== undefined) Object.defineProperty(HTMLElement.prototype, "clientHeight", orig);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)["clientHeight"];
    }
  });

  it("P-114 (parte do renderer): evento do board → card atualizado no DOM, e abrir o detalhe, em poucos ms", async () => {
    const lista = mil();
    let atual = lista;
    let disparar: () => void = () => undefined;
    const base = custoFalso();
    const board = { ...base.board, snapshot: vi.fn(async () => modeloFalso(atual)), assinar: vi.fn((f: () => void) => { disparar = f; return () => undefined; }) };
    (globalThis as unknown as { ade: unknown }).ade = { custo: base.custo, board };
    const store = criarStoreBoard({ api: () => board as never, armazem: armazem() });
    const workspaces = criarStoreWorkspaces({ api: () => ({ estado: async () => ({ atual: ws("w1"), recentes: [] }), assinar: () => () => undefined }) as never });
    await workspaces.iniciar();
    await act(async () => { render(<TelaBoard store={store} workspaces={workspaces} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    atual = lista.map((c) => (c.task_id === "T-01" ? { ...c, custo: { usd: 7.77, incompleto: false, aproximado: false } } : c));
    const t0 = performance.now();
    await act(async () => { disparar(); await new Promise((r) => setTimeout(r, 0)); });
    const evento = performance.now() - t0;
    expect(screen.getByRole("article", { name: /^T-01,.*US\$ 7,77/ })).toBeTruthy();
    const t1 = performance.now();
    await act(async () => { fireEvent.click(screen.getByRole("article", { name: /^T-02,/ })); });
    await screen.findByRole("complementary");
    const detalhe = performance.now() - t1;
    // eslint-disable-next-line no-console
    console.log(`P-114/P-116 jsdom: evento→DOM ${evento.toFixed(1)} ms; abrir detalhe ${detalhe.toFixed(1)} ms`);
    expect(evento).toBeLessThan(300);
    expect(detalhe).toBeLessThan(300);
  });
});
