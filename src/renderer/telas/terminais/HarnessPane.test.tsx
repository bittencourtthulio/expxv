// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decisoes, harnessFalso, RESPOSTA_LIMITES, trocas } from "../../a11y/ade-falso-harness";
import { criarStoreHarnessPane } from "../../estado/harness-pane";
import { storeLimites } from "../../estado/limites";
import { FaixaHarness, MoverPane } from "./HarnessPane";

afterEach(() => { cleanup(); delete (globalThis as { ade?: unknown }).ade; });

function criar(extra: Record<string, unknown> = {}) {
  const eventos: Array<(e: unknown) => void> = [];
  const api = { ...harnessFalso(), assinar: (cb: (e: unknown) => void) => { eventos.push(cb); return () => undefined; }, ...extra };
  const avisar = vi.fn();
  const store = criarStoreHarnessPane({ api: () => api as never, avisar });
  return { api, avisar, store, emitir: (e: unknown) => eventos.forEach((cb) => cb(e)) };
}

describe("store do harness no Pane", () => {
  it("sugestão chega por evento, vira faixa do pane e gera toast; recibo vem das Decisions", async () => {
    const { store, avisar, emitir } = criar();
    await store.iniciar();
    expect(store.obter().recibos["pane-1"]).toBe("conta cl·1 reseta antes");
    await act(async () => { emitir({ tipo: "troca_sugerida", troca_id: "t1", pane_id: "pane-9" }); await Promise.resolve(); await Promise.resolve(); });
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining("Sugestão de troca"), "aviso");
    await vi.waitFor(() => expect(store.obter().sugestoes["pane-9"]?.id).toBe("t1"));
  });
  it("troca feita e falhou geram toasts com o tom certo", async () => {
    const { store, avisar, emitir } = criar();
    await store.iniciar();
    await act(async () => { emitir({ tipo: "troca_feita", troca_id: "t2", pane_antigo_id: "a", pane_novo_id: "b" }); emitir({ tipo: "troca_falhou", troca_id: "t3", pane_id: "a" }); });
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining("movido"), "sucesso");
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining("falhou"), "erro");
  });
  it("mover sem destino mostra no_capacity em texto", async () => {
    const { store } = criar({ moverPane: vi.fn().mockRejectedValue(new Error("no_capacity")) });
    expect(await store.mover("p")).toBeNull();
    expect(store.obter().erro).toMatch(/no_capacity/);
  });
  it("sem canais: não faz nada e não quebra", async () => {
    const store = criarStoreHarnessPane({ api: () => undefined });
    await store.iniciar();
    expect(store.obter()).toEqual({ sugestoes: {}, recibos: {}, erro: null });
  });
});

describe("Pane: faixa de sugestão, recibo e mover", () => {
  it("recibo colapsável 'Por que esta conta'", async () => {
    const { store } = criar();
    await act(async () => { await store.iniciar(); });
    await act(async () => { render(<FaixaHarness paneId="pane-1" store={store} />); });
    expect(screen.getByText("Por que esta conta")).toBeTruthy();
    expect(screen.getByText("conta cl·1 reseta antes")).toBeTruthy();
  });
  it("sem sugestão nem recibo, nada é renderizado (não cresce o cromado)", async () => {
    const { store } = criar();
    await act(async () => { await store.iniciar(); });
    const { container } = render(<FaixaHarness paneId="nenhum" store={store} />);
    expect(container.firstChild).toBeNull();
  });
  it("faixa de sugestão de uma linha: mover aceita; ignorar adia 30 min e a faixa some", async () => {
    const decidirTroca = vi.fn().mockResolvedValue(trocas[0]);
    const listarTrocas = vi.fn().mockResolvedValue({ itens: [trocas[0]], proximo: null });
    const { store, emitir } = criar({ decidirTroca, listarTrocas });
    await act(async () => { await store.iniciar(); emitir({ tipo: "troca_sugerida", troca_id: "t1", pane_id: "pane-1" }); });
    await act(async () => { render(<FaixaHarness paneId="pane-1" store={store} />); });
    await vi.waitFor(() => expect(screen.getByRole("status").textContent).toContain("▲ conta 87% — sugerido: claude"));
    listarTrocas.mockResolvedValue({ itens: [], proximo: null });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ignorar a sugestão por 30 minutos" })); });
    expect(decidirTroca).toHaveBeenCalledWith("t1", "adiar_30min");
    expect(screen.queryByRole("button", { name: /Ignorar a sugestão/ })).toBeNull();
  });
  it("mover: mostra o aviso de pensamento perdido e move para o destino escolhido", async () => {
    const moverPane = vi.fn().mockResolvedValue({ novo_pane_id: "n", de: trocas[0]!.de, para: trocas[0]!.para });
    const { store } = criar({ moverPane });
    (globalThis as unknown as { ade: unknown }).ade = { limites: { snapshot: async () => RESPOSTA_LIMITES, assinar: () => () => undefined } };
    await act(async () => { await storeLimites.iniciar(); await storeLimites.atualizar(); });
    await act(async () => { render(<MoverPane paneId="pane-1" rotulo="#3" store={store} />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mover #3 para outra conta" })); });
    expect(screen.getByRole("dialog", { name: "Mover #3" }).textContent).toMatch(/pensamento/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /cl·1 · claude/ })); });
    expect(moverPane).toHaveBeenCalledWith("pane-1", "c1");
  });
  it("mover sem destino exibe no_capacity em texto na faixa", async () => {
    const { store } = criar({ moverPane: vi.fn().mockRejectedValue(new Error("no_capacity")) });
    await act(async () => { await store.iniciar(); await store.mover("pane-1"); });
    await act(async () => { render(<FaixaHarness paneId="pane-1" store={store} />); });
    expect(screen.getByRole("alert").textContent).toMatch(/no_capacity/);
  });
});
void decisoes;
