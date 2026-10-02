// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { storeMemoria } from "../estado/memoria";
import { instalar, remover } from "./ade-falso";
import { formatar, varrer } from "./varredura";
import { irParaTela } from "./ir-menu";

// T-08.28: varredura de acessibilidade da tela Memória (todas as abas, gaveta, diálogos) e das integrações (Configurações, Missão, paleta).
const confere = (onde: string): void => {
  const achados = varrer(document.body);
  expect(achados.length === 0 ? "" : `${onde}\n${formatar(achados)}`).toBe("");
};
const ir = irParaTela;
const clicar = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };
const esc = async () => { await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); }); };

beforeEach(() => { instalar(); storeMemoria.reiniciar(); });
afterEach(() => { cleanup(); remover(); vi.restoreAllMocks(); });

describe("varredura de acessibilidade: Memória", () => {
  it("tabela, gaveta, edição, confirmação e a navegação por teclado", async () => {
    render(<App />);
    await ir("Memória");
    const grade = await screen.findByRole("grid", { name: "Entradas da memória" });
    confere("Memória: tabela");
    expect(screen.getByRole("navigation", { name: "Principal" }).querySelector('[aria-current="page"]')?.textContent).toMatch(/Memória/);
    await clicar(within(grade).getAllByRole("row")[1]!);
    await screen.findByRole("complementary");
    confere("Memória: gaveta");
    await clicar(screen.getByRole("button", { name: "Editar" }));
    confere("Memória: editando");
    await clicar(screen.getByRole("button", { name: "Cancelar" }));
    await clicar(screen.getByRole("button", { name: "Esquecer" }));
    await screen.findByRole("dialog", { name: "Esquecer esta entrada?" });
    confere("Memória: confirmar esquecer");
    await esc();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("abas Squad, Projeto, Preferências e Saúde (com diálogo de apagar e o cartão do memox)", async () => {
    render(<App />);
    await ir("Memória");
    await screen.findByRole("grid");
    for (const aba of ["Squad", "Projeto"]) {
      await clicar(screen.getByRole("tab", { name: aba }));
      await act(async () => { await Promise.resolve(); });
      confere(`Memória: ${aba}`);
    }
    await clicar(screen.getByRole("tab", { name: "Preferências" }));
    await screen.findByText("Responder em português do Brasil");
    confere("Memória: Preferências");
    await clicar(screen.getAllByRole("button", { name: "Remover" })[0]!);
    await screen.findByRole("dialog", { name: "Remover a preferência?" });
    confere("Memória: remover preferência");
    await esc();
    await clicar(screen.getByRole("tab", { name: "Saúde" }));
    await screen.findByRole("region", { name: "Saúde" });
    confere("Memória: Saúde");
    await clicar(screen.getByRole("button", { name: "Apagar…" }));
    await screen.findByRole("dialog", { name: "Apagar a memória deste projeto?" });
    confere("Memória: apagar");
    await esc();
  });

  it("estados vazio e erro", async () => {
    const api = (globalThis as unknown as { ade: { memoria: { listar: () => Promise<unknown> } } }).ade.memoria;
    api.listar = async () => ({ itens: [], proximo: null });
    render(<App />);
    await ir("Memória");
    await screen.findByRole("heading", { name: "Memória vazia" });
    confere("Memória: vazio");
    api.listar = async () => { throw new Error("falhou"); };
    await clicar(screen.getByRole("tab", { name: "Projeto" }));
    await screen.findByRole("alert");
    confere("Memória: erro");
  });

  it("Restaurar painel (paleta) e a prévia do brief", async () => {
    render(<App />);
    await ir("Memória");
    await screen.findByRole("grid");
    await clicar(screen.getByRole("button", { name: "Restaurar painel" }));
    await screen.findByRole("dialog", { name: "Restaurar painel" });
    await waitFor(() => expect(screen.queryByText("Procurando painéis…")).toBeNull());
    confere("Memória: restaurar painel");
    await esc();
  });

  it("Configurações → Memória e Missão → Memória", async () => {
    render(<App />);
    await ir("Configurações");
    await screen.findByRole("heading", { name: "Configurações" });
    await clicar(screen.getByRole("tab", { name: "Memória" }));
    await screen.findByRole("switch", { name: /Memória neste computador/ });
    confere("Configurações: Memória");
    await clicar(screen.getByRole("button", { name: "Apagar memória deste projeto" }));
    await screen.findByRole("dialog", { name: "Apagar a memória deste projeto?" });
    confere("Configurações: apagar memória");
    await esc();
    await ir("Missões");
    await screen.findByRole("heading", { name: "Quadro" });
    await clicar((await screen.findAllByRole("button", { name: /Login/ }))[0]!);
    await screen.findByRole("region", { name: "Memória da missão" });
    confere("Missões: Memória");
  });

  it("a paleta (⌘K) lista os comandos de Memória e abrir leva à tela", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Hoje" });
    await act(async () => { fireEvent.keyDown(window, { key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }); });
    const paleta = await screen.findByRole("dialog", { name: "Paleta de comandos" });
    fireEvent.change(within(paleta).getByRole("combobox"), { target: { value: "Memória" } });
    await within(paleta).findByText("Memória: abrir");
    confere("paleta: Memória");
    await act(async () => { fireEvent.click(within(paleta).getByText("Memória: abrir")); });
    await screen.findByRole("grid", { name: "Entradas da memória" });
  });

  it("a Memória é lazy: não carrega nada no boot", async () => {
    const memoria = (globalThis as unknown as { ade: { memoria: { estado: () => Promise<unknown>; listar: () => Promise<unknown> } } }).ade.memoria;
    const estado = vi.spyOn(memoria, "estado");
    const listar = vi.spyOn(memoria, "listar");
    render(<App />);
    await screen.findByRole("heading", { name: "Hoje" });
    expect(estado).not.toHaveBeenCalled();
    expect(listar).not.toHaveBeenCalled();
  });
});
