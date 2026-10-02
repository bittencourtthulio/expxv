// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { IndiceProjeto, Trabalho } from "../../../nucleo/metodo/tipos";
import { criarStoreExecucaoMetodo } from "../../estado/execucao-metodo";
import { criarStoreMetodo } from "../../estado/metodo";
import { indice, tk, trabalho } from "../metodo/fabrica";
import Tela from "./index";
import { CHAVE_VISAO } from "./visao";

const T = (id: string, titulo: string, o: Partial<Trabalho> = {}, tasks = [tk(`${id}-1`, { status: "concluida" }), tk(`${id}-2`)]) => trabalho(tasks, { id, titulo, ...o });
const LOTE = [
  T("a", "Exportar PDF", { tipo: "feature", status: "em_andamento", estagio: "f6", ultima_atividade: "2026-10-01T10:00:00Z" }),
  T("b", "Botão Salvar quebrado", { tipo: "ocorrencia", ferramenta: "runx", status: "em_andamento", estagio: "e3", ultima_atividade: "2026-10-01T09:00:00Z" }),
  T("c", "Sistema de convites", { tipo: "projeto", ferramenta: "buildx", status: "em_andamento", estagio: "b2", decisoes_pendentes: 1 }),
  T("d", "Relatório mensal", { status: "concluido", estagio: "f6" }, [tk("d-1", { status: "concluida" })]),
  T("e", "Login social", { status: "bloqueado", estagio: "f6" }),
];
const vazio = (): [string | null, IndiceProjeto | null] => ["w1", indice([])];

function montar(atual: string | null, resp: IndiceProjeto | null, memoria?: Map<string, string>) {
  const api = {
    metodo: { estado: vi.fn(async () => resp), assinar: () => () => {}, rastro: vi.fn(async () => ({ eventos: [], proximo: 0 })) },
    workspaces: { estado: async () => ({ atual: atual ? { id: atual } : null, recentes: [] }), assinar: () => () => {} },
  } as unknown as ApiAde;
  (globalThis as unknown as { ade: unknown }).ade = api;
  const store = criarStoreMetodo({ api: () => api });
  const irParaMetodo = vi.fn();
  const execucao = criarStoreExecucaoMetodo({ irParaMetodo, irParaSessao: vi.fn(), irParaTerminais: vi.fn(), config: () => undefined, armazem: () => undefined });
  void memoria;
  return { ...render(<Tela store={store} execucao={execucao} />), execucao, irParaMetodo };
}

let mem: Map<string, string>;
beforeEach(() => {
  mem = new Map();
  vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (globalThis as { ade?: unknown }).ade; });

describe("Tela Trabalhos", () => {
  it("sem workspace: estado vazio claro", async () => {
    montar(null, null);
    expect(await screen.findByText("Nenhum projeto aberto")).toBeTruthy();
  });

  it("vazio: convida a fazer um pedido no Método e leva ao composer com o gesto padrão", async () => {
    const [ws, resp] = vazio();
    const { execucao, irParaMetodo } = montar(ws, resp);
    expect(await screen.findByText("Nenhum trabalho ainda")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Fazer um pedido no Método/ }));
    expect(execucao.obter().gestoSolicitado?.gesto).toBe("nova_feature");
    expect(irParaMetodo).toHaveBeenCalled();
  });

  it("resumo bate com o índice (em andamento, aguardando, entregues, bloqueados) sem número inventado", async () => {
    montar("w1", indice(LOTE));
    const resumo = await screen.findByRole("region", { name: "Resumo dos trabalhos" });
    const n = (r: string) => within(resumo).getByRole("button", { name: new RegExp(`^${r}:`) }).textContent;
    expect(n("Em andamento")).toBe("2Em andamento");
    expect(n("Aguardando você")).toBe("1Aguardando você");
    expect(n("Entregues")).toBe("1Entregues");
    expect(n("Bloqueados")).toBe("1Bloqueados");
    expect(resumo.textContent).toContain("5trabalhos");
  });

  it("filtros: busca, tipo e estado (pelo resumo também) com contador", async () => {
    montar("w1", indice(LOTE));
    await screen.findByRole("region", { name: "Resumo dos trabalhos" });
    expect(screen.getByRole("status").textContent).toBe("5 trabalhos");
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar trabalho" }), { target: { value: "botao" } });
    expect(screen.getByRole("status").textContent).toBe("1 de 5 trabalhos");
    expect(screen.getByRole("button", { name: /Botão Salvar quebrado/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Exportar PDF/ })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar trabalho" }), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "projeto" } });
    expect(screen.getByRole("status").textContent).toBe("1 de 5 trabalhos");
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "todos" } });
    fireEvent.click(screen.getByRole("button", { name: /^Entregues:/ }));
    expect(screen.getByRole("button", { name: /^Entregues:/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Relatório mensal/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Exportar PDF/ })).toBeNull();
  });

  it("filtro sem resultado: estado vazio acionável que limpa os filtros", async () => {
    montar("w1", indice(LOTE));
    await screen.findByRole("region", { name: "Resumo dos trabalhos" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar trabalho" }), { target: { value: "zzz" } });
    expect(screen.getByText("Nenhum trabalho com esses filtros")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(screen.getByRole("status").textContent).toBe("5 trabalhos");
  });

  it("colunas por estágio com os trabalhos certos em cada uma", async () => {
    montar("w1", indice(LOTE));
    await screen.findByRole("region", { name: "Resumo dos trabalhos" });
    const col = (n: string) => screen.getByRole("region", { name: `Coluna ${n}` });
    expect(within(col("Em execução")).getByRole("button", { name: /Exportar PDF/ })).toBeTruthy();
    expect(within(col("Em execução")).getByRole("button", { name: /Botão Salvar quebrado/ })).toBeTruthy();
    expect(within(col("Planejado")).getByRole("button", { name: /Sistema de convites/ })).toBeTruthy();
    expect(within(col("Entregue")).getByRole("button", { name: /Relatório mensal/ })).toBeTruthy();
    expect(within(col("Ideia")).queryAllByRole("button")).toHaveLength(0);
  });

  it("a visão escolhida é memorizada e volta ao reabrir", async () => {
    const a = montar("w1", indice(LOTE));
    await screen.findByRole("region", { name: "Resumo dos trabalhos" });
    expect(screen.getByRole("button", { name: "Cartões em colunas" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Linha do tempo" }));
    expect(mem.get(CHAVE_VISAO)).toBe("linha");
    expect(screen.getByRole("list", { name: "Trabalhos em linha do tempo" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Coluna Planejado" })).toBeNull();
    a.unmount();
    montar("w1", indice(LOTE));
    await screen.findByRole("region", { name: "Resumo dos trabalhos" });
    expect(screen.getByRole("button", { name: "Linha do tempo" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("localStorage indisponível não quebra a tela", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } });
    montar("w1", indice(LOTE));
    await screen.findByRole("region", { name: "Resumo dos trabalhos" });
    fireEvent.click(screen.getByRole("button", { name: "Linha do tempo" }));
    expect(screen.getByRole("list", { name: "Trabalhos em linha do tempo" })).toBeTruthy();
  });

  it("abrir o detalhe (plano, quadro, grafo e rastro) e voltar, por botão e por Esc", async () => {
    const t = T("a", "Exportar PDF", {
      estagio: "f6", sinaleira: { cor: "amarelo", motivo: "Auditoria pendente", motivos: [] }, veredito_auditoria: "aprovado",
      entrega: { estado: "aberta", branch: "feat/x", portao: "PRONTO", pr_url: null, pr_estado: null, commits: 3, arquivo: "docs/mergex/E.md" },
    }, [tk("T-1", { status: "concluida" }), tk("T-2", { depende_de: ["T-1"] })]);
    montar("w1", indice([t]));
    const cartao = await screen.findByRole("button", { name: /Exportar PDF/ });
    cartao.focus();
    await act(async () => { fireEvent.click(cartao); });
    const painel = screen.getByRole("complementary", { name: "Detalhe do trabalho" });
    expect(within(painel).getByRole("heading", { name: "Exportar PDF" })).toBeTruthy();
    expect(within(painel).getByText("feat/x")).toBeTruthy();
    expect(within(painel).getByText(/Auditoria:/).textContent).toContain("Aprovado");
    await act(async () => { fireEvent.click(within(painel).getByRole("tab", { name: "Quadro" })); });
    expect(within(painel).getByRole("region", { name: "Coluna Pendente" })).toBeTruthy();
    await act(async () => { fireEvent.click(within(painel).getByRole("tab", { name: "Grafo" })); });
    expect(await within(painel).findByRole("img", { name: /Grafo do plano/ })).toBeTruthy();
    fireEvent.click(within(painel).getByRole("button", { name: "Voltar" }));
    expect(screen.queryByRole("complementary", { name: "Detalhe do trabalho" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Exportar PDF/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Exportar PDF/ })); });
    fireEvent.keyDown(screen.getByRole("complementary", { name: "Detalhe do trabalho" }), { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Detalhe do trabalho" })).toBeNull();
  });

  it("Novo pedido leva ao Método; com filtro de tipo, já com o gesto do tipo", async () => {
    const { execucao, irParaMetodo } = montar("w1", indice(LOTE));
    await screen.findByRole("region", { name: "Resumo dos trabalhos" });
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    expect(execucao.obter().gestoSolicitado?.gesto).toBe("nova_feature");
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "ocorrencia" } });
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    expect(execucao.obter().gestoSolicitado).toMatchObject({ gesto: "nova_ocorrencia", n: 2 });
    expect(irParaMetodo).toHaveBeenCalledTimes(2);
  });
});

describe("Tela Trabalhos: escala", () => {
  const MUITOS = Array.from({ length: 320 }, (_, i) => T(`t${i}`, `Trabalho ${i}`, {
    tipo: i % 3 === 0 ? "ocorrencia" : "feature", status: i % 5 === 0 ? "concluido" : "em_andamento", estagio: ["f3", "f6", "e3", "e4", "f2"][i % 5] as string,
    ultima_atividade: new Date(Date.UTC(2026, 9, 1, 0, 0, 0) - i * 60_000).toISOString(),
  }, Array.from({ length: 30 }, (_, k) => tk(`t${i}-${k}`, { status: k < i % 30 ? "concluida" : "pendente" }))));

  for (const v of ["colunas", "linha"] as const) {
    it(`320 trabalhos na visão ${v}: monta rápido e só cria as linhas visíveis`, async () => {
      mem.set(CHAVE_VISAO, v);
      const t0 = performance.now();
      montar("w1", indice(MUITOS));
      await screen.findByRole("region", { name: "Resumo dos trabalhos" });
      const gasto = performance.now() - t0;
      expect(gasto).toBeLessThan(2_500);
      const itens = document.querySelectorAll(".trab-cartao, button.trab-linha").length;
      expect(itens).toBeGreaterThan(0);
      expect(itens).toBeLessThan(120);
      expect(screen.getByRole("region", { name: "Resumo dos trabalhos" }).textContent).toContain("320trabalhos");
    });
  }
});
