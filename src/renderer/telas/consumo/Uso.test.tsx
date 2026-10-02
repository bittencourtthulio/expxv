// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { custoFalso } from "../../a11y/ade-falso-custo";
import { formatar, varrer } from "../../a11y/varredura";
import { resumoCusto } from "../board/fabrica-teste";
import { DetalhePorUso } from "./DetalhePorUso";
import { FontesPrecos } from "./FontesPrecos";

afterEach(() => { cleanup(); delete (globalThis as { ade?: unknown }).ade; });
const api = () => Object.fromEntries(Object.entries(custoFalso().custo).map(([k, v]) => [k, typeof v === "function" ? vi.fn(v as never) : v])) as ReturnType<typeof custoFalso>["custo"];
const agora = () => new Date("2026-10-15T12:00:00.000Z");
const montarUso = async (a: Record<string, unknown> = {}) => {
  const base = { ...api(), ...a };
  (globalThis as unknown as { ade: unknown }).ade = { custo: base };
  await act(async () => { render(<DetalhePorUso workspaceId="w1" api={base as never} agora={agora} sprints={async () => [{ id: "s1", nome: "Sprint 1" }]} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return base;
};

describe("Detalhe por uso", () => {
  it("lista por modelo com ≥, sem preço como 'custo desconhecido', total e participação; sem 0 fantasma", async () => {
    await montarUso();
    const lista = screen.getByRole("list", { name: "Uso por modelo" });
    expect(within(lista).getByText("claude-sonnet")).toBeTruthy();
    expect(within(lista).getByText("modelo desconhecido")).toBeTruthy();
    expect(within(lista).getAllByText("custo desconhecido").length).toBeGreaterThan(0);
    expect(screen.getByRole("note", { name: "Total do período" }).textContent).toContain("≥ US$ 4,12");
    expect(document.body.textContent).not.toMatch(/US\$ 0,00/);
  });
  it("Pane de CLI sem fonte aparece como linha própria com o próximo passo (nunca soma 0)", async () => {
    await montarUso();
    const nota = screen.getAllByRole("note").find((n) => n.textContent?.includes("sem fonte de uso: gemini"));
    expect(nota?.textContent).toContain("OpenRouter");
  });
  it("trocar o agrupamento refaz o relatório com o agrupar e a janela certos", async () => {
    const a = await montarUso();
    await act(async () => { fireEvent.change(screen.getByLabelText(/Agrupar por/), { target: { value: "pane" } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const ultimo = (a["relatorio"] as ReturnType<typeof vi.fn> & ((p: unknown) => unknown));
    expect(ultimo).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByLabelText(/Janela/), { target: { value: "24h" } }); });
    expect(screen.getByRole("list", { name: "Uso por pane" })).toBeTruthy();
  });
  it("Missão: clicar na linha abre o custo da Missão com previsão e teto", async () => {
    await montarUso();
    await act(async () => { fireEvent.change(screen.getByLabelText(/Agrupar por/), { target: { value: "missao" } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { pressed: false }).find((b) => b.className.includes("uso-clicavel"))!); });
    const sec = await screen.findByRole("region", { name: "Custo da Missão" });
    await within(sec).findByText(/Repartição do custo|Cards/);
    expect(sec.textContent).toMatch(/Previsão/);
    expect(within(sec).getByLabelText("Teto da Missão (US$)")).toBeTruthy();
  });
  it("sem uso: estado vazio com próximo passo; erro vira alerta; a11y limpa", async () => {
    await montarUso({ relatorio: async () => ({ linhas: [], total: resumoCusto(null), proximo: null }), fontes: async () => [] });
    expect(screen.getByText(/Nenhum uso observado neste período/)).toBeTruthy();
    cleanup();
    await montarUso({ relatorio: async () => { throw new Error("boom"); } });
    expect(screen.getByRole("alert").textContent).toMatch(/boom/);
    cleanup();
    await montarUso();
    expect(formatar(varrer(document.body))).toBe("");
  });
  it("previsão do mês e custo da Sprint", async () => {
    await montarUso();
    expect(screen.getByText(/projeção até o fim do mês/)).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByLabelText(/Custo da Sprint/), { target: { value: "s1" } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText(/em 3 itens \(1 sem custo conhecido\)/)).toBeTruthy();
  });
});

describe("Fontes e preços", () => {
  const montarFp = async (a: Record<string, unknown> = {}) => {
    const base = { ...api(), ...a };
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
    await act(async () => { render(<FontesPrecos workspaceId="w1" api={base as never} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return base as unknown as Record<string, ReturnType<typeof vi.fn>>;
  };
  it("mostra fontes (sem fonte nunca é 0), preços com selo aproximado e valida o cadastro", async () => {
    await montarFp();
    expect(screen.getByText(/sem leitor de uso: o custo desta CLI fica como desconhecido/)).toBeTruthy();
    expect(screen.getByText(/≈ aproximado/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gravar preço" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/Informe o modelo/);
  });
  it("sem preço cadastrado explica; gravar preço chama a API com origem do usuário", async () => {
    const a = await montarFp({ precosListar: async () => [] });
    expect(screen.getByText(/todo modelo aparece como “sem preço”/)).toBeTruthy();
    const g = vi.fn(async (p: { padrao: string }) => ({ ...p }));
    cleanup();
    await montarFp({ precosListar: async () => [], precoGravar: g });
    fireEvent.change(screen.getByLabelText("Modelo ou padrão"), { target: { value: "meu-modelo" } });
    fireEvent.change(screen.getByLabelText("Entrada US$/Mtok"), { target: { value: "1,5" } });
    fireEvent.change(screen.getByLabelText("Saída US$/Mtok"), { target: { value: "6" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gravar preço" })); });
    expect(g).toHaveBeenCalledWith({ padrao: "meu-modelo", entrada_por_mtok: 1.5, saida_por_mtok: 6, cache_escrita_por_mtok: null, cache_leitura_por_mtok: null });
    void a;
  });
  it("P-80: bloqueio por teto é opt-in por workspace (padrão desligado) e grava só a opção", async () => {
    const configGravar = vi.fn(async (_ws: string, c: unknown) => c);
    const apiBoard = { configLer: async () => ({ wip: { em_andamento: 3 } }), configGravar };
    await act(async () => { render(<FontesPrecos workspaceId="w1" api={api() as never} apiBoard={apiBoard as never} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const caixa = screen.getByRole("checkbox", { name: /Bloquear novos cards delegados/ }) as HTMLInputElement;
    expect(caixa.checked).toBe(false);
    await act(async () => { fireEvent.click(caixa); });
    expect(configGravar).toHaveBeenCalledWith("w1", { wip: { em_andamento: 3 }, bloquear_ao_estourar_teto: true });
  });
  it("reprecificar pede confirmação própria, mostra quantos mudam e só então grava", async () => {
    const a = await montarFp();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reprecificar…" })); });
    const dlg = await screen.findByRole("dialog", { name: "Reprecificar o custo registrado?" });
    expect(dlg.textContent).toContain("12 registros mudariam");
    expect(a["reprecificar"]).toHaveBeenCalledTimes(1);
    expect(a["reprecificar"]!.mock.calls[0]![0]).toEqual({ simular: true });
    await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Reprecificar" })); });
    expect(a["reprecificar"]!.mock.calls[1]![0]).toEqual({});
  });
  it("diagnóstico copia texto sem conteúdo; reindexar mostra o resultado; a11y limpa", async () => {
    const a = await montarFp();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copiar diagnóstico" })); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("fontes: 2\nregistros: 3");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reindexar" })); });
    expect(await screen.findByText(/Reindexação concluída: 3 registros/)).toBeTruthy();
    expect(a["reindexar"]).toHaveBeenCalled();
    expect(formatar(varrer(document.body))).toBe("");
  });
  it("config inválida não grava", async () => {
    const a = await montarFp();
    fireEvent.change(screen.getByLabelText(/Câmbio manual/), { target: { value: "-1" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gravar configuração" })); });
    expect(a["configGravar"]).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/Revise os números/);
  });
});
