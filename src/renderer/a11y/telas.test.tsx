// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { instalar, remover } from "./ade-falso";
import { formatar, varrer } from "./varredura";

// T-05.05: varredura automatizada de cada tela (e dos diálogos/menus que ela abre) com `ade()` falso.
const confere = (onde: string): void => {
  const achados = varrer(document.body);
  expect(achados.length === 0 ? "" : `${onde}\n${formatar(achados)}`).toBe("");
};
const ir = async (nome: string) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${nome}`) })); }); };
const clicar = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };
const esc = async () => { await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); }); };

beforeEach(() => { instalar(); });
afterEach(() => { remover(); vi.restoreAllMocks(); });

describe("varredura de acessibilidade das telas", () => {
  it("casca (menu, topo, rodapé) e Início", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Hoje" });
    confere("Início");
    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(document.querySelectorAll("header, [role=banner]").length).toBeGreaterThan(0);
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(screen.getByRole("search")).toBeTruthy();
  });

  it("seletor de workspace aberto e paleta de comandos (⌘K)", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Hoje" });
    const gatilho = screen.getByRole("button", { name: /w1/ });
    await clicar(gatilho);
    await screen.findByRole("menu", { name: "Workspaces" });
    confere("seletor de workspace");
    await esc();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(gatilho); // Esc devolve o foco
    gatilho.focus();
    await act(async () => { fireEvent.keyDown(window, { key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }); });
    await screen.findByRole("dialog", { name: "Paleta de comandos" });
    confere("paleta de comandos");
    await esc();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(gatilho); // fechar a paleta devolve o foco
  });

  it("Missões: quadro, lista, wizard, detalhe, portões e confirmações", async () => {
    render(<App />);
    await ir("Missões");
    await screen.findByRole("heading", { name: "Quadro" });
    await screen.findAllByText("Login");
    confere("Missões: quadro");
    await clicar(screen.getByRole("button", { name: "Lista" }));
    confere("Missões: lista");
    await clicar(screen.getByRole("button", { name: "Nova missão" }));
    await screen.findByRole("dialog", { name: "Nova missão" });
    confere("Missões: wizard");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Criar missão" })); });
    confere("Missões: wizard com erros");
    await esc();
    await clicar(screen.getAllByRole("button", { name: /Login/ })[0]!);
    await screen.findByText("Rota pronta");
    await screen.findByRole("region", { name: "Portões" });
    confere("Missões: detalhe");
    await clicar(screen.getAllByRole("button", { name: /^Liberar/ })[0]!);
    await screen.findByRole("dialog");
    confere("Missões: confirmar portão");
    await esc();
    await clicar(screen.getByRole("button", { name: "Abortar" }));
    await screen.findByRole("dialog", { name: "Abortar a missão?" });
    confere("Missões: confirmar abortar");
  });

  it("Método: lista, detalhe e todas as abas", async () => {
    render(<App />);
    await ir("Método");
    await screen.findByRole("heading", { name: "Andamento" });
    await screen.findByRole("button", { name: /Minha feature/ });
    confere("Método: trabalhos");
    await clicar(screen.getByRole("button", { name: /Minha feature/ }));
    const painel = screen.getByRole("tab", { name: "Plano" });
    expect(painel.getAttribute("aria-controls")).toBeTruthy();
    for (const aba of ["Plano", "Quadro", "Grafo", "Rastro"]) {
      await clicar(screen.getByRole("tab", { name: aba }));
      if (aba === "Grafo") await screen.findByRole("img", { name: /Grafo do plano/ });
      if (aba === "Rastro") await screen.findByText(/de 1 eventos/);
      confere(`Método: ${aba}`);
    }
    for (const aba of [/^Violações/, "Instalação", "Saúde"]) {
      await clicar(screen.getByRole("tab", { name: aba }));
      confere(`Método: ${String(aba)}`);
    }
  });

  it("Método: setas movem foco e seleção entre as abas (tabindex roving)", async () => {
    render(<App />);
    await ir("Método");
    await screen.findByRole("button", { name: /Minha feature/ });
    const abas = screen.getAllByRole("tab").slice(0, 4);
    abas[0]!.focus();
    expect(abas.map((a) => a.tabIndex)).toEqual([0, -1, -1, -1]);
    await act(async () => { fireEvent.keyDown(abas[0]!, { key: "ArrowRight" }); });
    expect(document.activeElement).toBe(abas[1]);
    expect(abas[1]!.getAttribute("aria-selected")).toBe("true");
    await act(async () => { fireEvent.keyDown(abas[1]!, { key: "End" }); });
    expect(document.activeElement).toBe(abas[3]);
    await act(async () => { fireEvent.keyDown(abas[3]!, { key: "ArrowRight" }); });
    expect(document.activeElement).toBe(abas[0]);
  });

  it("Workspaces: cartões, worktrees e confirmações", async () => {
    render(<App />);
    await ir("Workspaces");
    await screen.findByRole("heading", { name: "Projetos" });
    await screen.findByRole("list", { name: "Workspaces recentes" });
    confere("Workspaces");
    await clicar(screen.getAllByRole("button", { name: "Worktrees" })[0]!);
    await screen.findByRole("list", { name: "Worktrees" });
    confere("Workspaces: worktrees");
    await clicar(screen.getAllByRole("button", { name: "Remover da lista" })[0]!);
    await screen.findByRole("dialog", { name: "Remover da lista?" });
    confere("Workspaces: confirmar remoção");
  });

  it("Provedores: CLIs, contas e diagnóstico", async () => {
    render(<App />);
    await ir("Provedores");
    await screen.findByRole("heading", { name: "CLIs e contas" });
    await screen.findByRole("list", { name: "CLIs detectadas" });
    confere("Provedores");
    await clicar(screen.getByRole("button", { name: "Diagnóstico" }));
    await screen.findByRole("textbox", { name: "Diagnóstico" });
    confere("Provedores: diagnóstico");
  });

  it("Configurações: todas as seções e o aviso do modo automático", async () => {
    render(<App />);
    await ir("Configurações");
    await screen.findByRole("heading", { name: "Configurações" });
    confere("Configurações");
    await clicar(screen.getByRole("button", { name: "Automático" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    confere("Configurações: confirmar automático");
    await clicar(screen.getByRole("button", { name: "Gerar diagnóstico" }));
    confere("Configurações: diagnóstico");
  });

  it("rodapé tem região viva polida para 'N aguardando você'", async () => {
    render(<App />);
    const vivo = document.querySelector(".rodape-live");
    expect(vivo?.getAttribute("aria-live")).toBe("polite");
    expect(within(screen.getByRole("contentinfo")).getByText("Pronto")).toBeTruthy();
  });
});
