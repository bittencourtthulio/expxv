// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatar, varrer } from "../a11y/varredura";
import { aoPedirAlertas, pedirPanicoTelegram } from "../estado/alertas-acoes";
import { criarStoreAlertas } from "../estado/alertas";
import { alertaFalso, apiAlertasFalsa, canalFalso } from "../telas/alertas/fabrica-teste";
import { DialogoPanico, DialogosAlertas } from "./DialogosAlertas";
import { IndicadorAlertas } from "./IndicadorAlertas";
import { IndicadorCanal } from "./IndicadorCanal";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const esperar = (ms = 15) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const clicar = (el: HTMLElement) => act(async () => { fireEvent.click(el); });

function storeCom(api = apiAlertasFalsa()) {
  const store = criarStoreAlertas({ api: () => api, ocioso: (f) => f() });
  return { api, store };
}

describe("indicador do topo", () => {
  it("aria-label com contagem e críticos; badge 99+; ponto crítico por forma", async () => {
    const { api, store } = storeCom();
    (api.contar as ReturnType<typeof vi.fn>).mockResolvedValue({ nao_lidos: 150, criticos: 2 });
    await act(async () => { render(<IndicadorAlertas store={store} />); });
    await esperar();
    const botao = screen.getByRole("button", { name: "Alertas, 150 não lidos, 2 críticos" });
    expect(within(botao).getByText("99+")).toBeTruthy();
    expect(within(botao).getByText("!")).toBeTruthy();
  });
  it("sem não lidos: sem badge", async () => {
    const { api, store } = storeCom();
    (api.contar as ReturnType<typeof vi.fn>).mockResolvedValue({ nao_lidos: 0, criticos: 0 });
    await act(async () => { render(<IndicadorAlertas store={store} />); });
    await esperar();
    expect(screen.getByRole("button", { name: "Alertas, nenhum não lido" }).querySelector(".alertas-badge")).toBeNull();
  });
  it("painel: até 8 itens, Esc fecha e devolve o foco, marcar tudo lido, abrir centro", async () => {
    const todos = Array.from({ length: 12 }, (_, i) => alertaFalso(`a${i}`, { criado_em: `2026-10-01T10:${String(i).padStart(2, "0")}:00.000Z` }));
    const api = apiAlertasFalsa({ alertas: todos });
    (api.listar as ReturnType<typeof vi.fn>).mockResolvedValue({ itens: todos, proximo: null });
    const { store } = storeCom(api);
    const aberto = vi.fn();
    const off = aoPedirAlertas(aberto);
    await act(async () => { render(<IndicadorAlertas store={store} />); });
    await esperar();
    const botao = screen.getByRole("button", { name: /^Alertas, / });
    await clicar(botao);
    await esperar();
    const painel = screen.getByRole("dialog", { name: "Alertas recentes" });
    expect(within(painel).getAllByRole("listitem")).toHaveLength(8);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    const a = varrer(document.body);
    expect(a.length === 0 ? "" : formatar(a)).toBe("");
    await clicar(within(painel).getByRole("button", { name: "Marcar tudo como lido" }));
    expect(api.marcarTodosLidos).toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(painel, { key: "Escape" }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(botao);
    await clicar(botao);
    await clicar(screen.getByRole("button", { name: "Abrir Centro" }));
    expect(aberto).toHaveBeenCalledWith({ aba: "alertas" });
    expect(screen.queryByRole("dialog")).toBeNull();
    off();
  });
  it("painel vazio explica", async () => {
    const { store } = storeCom();
    await act(async () => { render(<IndicadorAlertas store={store} />); });
    await clicar(screen.getByRole("button", { name: /^Alertas, / }));
    await esperar();
    expect(screen.getByText(/Nada por aqui/)).toBeTruthy();
  });
});

describe("indicador de canal no rodapé", () => {
  it("mostra só canal externo ativo, por forma e texto; clique abre Canais", async () => {
    const api = apiAlertasFalsa();
    (api.canais.listar as ReturnType<typeof vi.fn>).mockResolvedValue([canalFalso({ estado: "ativo", entrada_ligada: true, saida_ligada: true }), canalFalso({ id: "so", tipo: "so", estado: "ativo", saida_ligada: true })]);
    const { store } = storeCom(api);
    const aberto = vi.fn();
    const off = aoPedirAlertas(aberto);
    store.iniciar();
    await act(async () => { render(<IndicadorCanal store={store} />); });
    await esperar();
    const b = screen.getByRole("button", { name: /Telegram · entrada ativa/ });
    expect(b.textContent).toContain("◆");
    await clicar(b);
    expect(aberto).toHaveBeenCalledWith({ aba: "canais" });
    off();
  });
  it("sem canal ativo não renderiza nada", async () => {
    const { store } = storeCom();
    const { container } = render(<IndicadorCanal store={store} />);
    expect(container.textContent).toBe("");
  });
});

describe("diálogos globais", () => {
  it("pedido de pareamento em qualquer tela: Permitir chama parearDecidir", async () => {
    const { api, store } = storeCom();
    store.iniciar();
    await act(async () => { render(<DialogosAlertas store={store} api={api} />); });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { (api.emitir["par"] as (x: unknown) => void)({ estado: "pedido", pedido: { pedido_id: "p1", nome: "Ana", user_id: 42 } }); await new Promise((r) => setTimeout(r, 5)); });
    const dlg = screen.getByRole("dialog");
    expect(dlg.textContent).toMatch(/Parear a conta Telegram .Ana. \(id 42\)\?/);
    await clicar(within(dlg).getByRole("button", { name: "Permitir" }));
    expect(api.telegram.parearDecidir).toHaveBeenCalledWith("p1", true);
    await esperar();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("Negar e Esc negam", async () => {
    const { api, store } = storeCom();
    store.iniciar();
    await act(async () => { render(<DialogosAlertas store={store} api={api} />); });
    await act(async () => { (api.emitir["par"] as (x: unknown) => void)({ estado: "pedido", pedido: { pedido_id: "p2", nome: "Zé", user_id: 7 } }); await new Promise((r) => setTimeout(r, 5)); });
    await act(async () => { fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); });
    expect(api.telegram.parearDecidir).toHaveBeenCalledWith("p2", false);
  });
  it("pânico: o diálogo abre por pedido, marcado por padrão para parar execuções; executa e mostra rotação do token", async () => {
    const { api, store } = storeCom();
    await act(async () => { render(<DialogosAlertas store={store} api={api} />); });
    await act(async () => { pedirPanicoTelegram(); });
    expect(api.telegram.panico).not.toHaveBeenCalled();
    const dlg = screen.getByRole("dialog", { name: /pânico/i });
    expect((within(dlg).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement?.textContent).toBe("Cancelar");
    await clicar(within(dlg).getByRole("button", { name: "Parar tudo" }));
    expect(api.telegram.panico).toHaveBeenCalledWith(true);
    await esperar();
    expect(screen.getByText(/rotacione o token no BotFather/)).toBeTruthy();
    expect(screen.getByText(/1 pareamento revogado/)).toBeTruthy();
  });
  it("pânico sem marcar a caixa não para as execuções; falha mostra erro", async () => {
    const api = apiAlertasFalsa();
    (api.telegram.panico as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("x"));
    await act(async () => { render(<DialogoPanico aoFechar={() => undefined} api={api} />); });
    await clicar(screen.getByRole("checkbox"));
    await clicar(screen.getByRole("button", { name: "Parar tudo" }));
    expect(api.telegram.panico).toHaveBeenCalledWith(false);
    await esperar();
    expect(screen.getByRole("alert").textContent).toMatch(/Não foi possível parar o bot/);
  });
});
