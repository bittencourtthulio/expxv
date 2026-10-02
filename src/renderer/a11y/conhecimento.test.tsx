// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { storeChat } from "../estado/chat";
import { storeConhecimento } from "../estado/conhecimento";
import { storeRag } from "../estado/rag";
import { instalar, remover } from "./ade-falso";
import { formatar, varrer } from "./varredura";
import { irParaTela } from "./ir-menu";

// Fase 15: varredura de acessibilidade das telas Conhecimento (todas as abas, busca, diálogos) e Chat (mensagens, plano, edição).
const confere = (onde: string): void => {
  const achados = varrer(document.body);
  expect(achados.length === 0 ? "" : `${onde}\n${formatar(achados)}`).toBe("");
};
const ir = irParaTela;
const clicar = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };
const esc = async () => { await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); }); };

beforeEach(() => {
  instalar();
  storeConhecimento.reiniciar(); storeChat.reiniciar(); storeRag.reiniciar();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
});
afterEach(() => { cleanup(); remover(); vi.restoreAllMocks(); });

describe("varredura de acessibilidade: Conhecimento", () => {
  it("grafo, lista, detalhe do nó e navegação marcada", async () => {
    render(<App />);
    await ir("Conhecimento");
    await screen.findByRole("group", { name: /Grafo de conhecimento/ });
    confere("Conhecimento: grafo");
    expect(screen.getByRole("navigation", { name: "Principal" }).querySelector('[aria-current="page"]')?.textContent).toMatch(/Conhecimento/);
    await clicar(screen.getByRole("tab", { name: "Lista" }));
    const lista = await screen.findByRole("list", { name: "Nós do grafo de conhecimento" });
    confere("Conhecimento: lista");
    await clicar(within(lista).getAllByRole("button")[0] as HTMLElement);
    await screen.findByRole("complementary", { name: "Detalhe do nó" });
    await waitFor(() => expect(screen.getByText("Vizinhos")).toBeTruthy());
    confere("Conhecimento: detalhe do nó");
  });

  it("busca com resultados e prévia do contexto", async () => {
    render(<App />);
    await ir("Conhecimento");
    const campo = await screen.findByRole("searchbox", { name: "Buscar no conhecimento" });
    await act(async () => { fireEvent.change(campo, { target: { value: "login" } }); });
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    await screen.findByRole("list", { name: "Resultados" });
    confere("Conhecimento: busca");
    await clicar(screen.getByRole("button", { name: "Prévia do contexto" }));
    await screen.findByRole("region", { name: "Prévia do contexto" });
    confere("Conhecimento: prévia do contexto");
  });

  it("fontes (com os três diálogos), aprendizados (com edição), config e backend (com consentimento)", async () => {
    render(<App />);
    await ir("Conhecimento");
    await screen.findByRole("tab", { name: "Fontes" });
    await clicar(screen.getByRole("tab", { name: "Fontes" }));
    await screen.findByRole("table", { name: "Documentos indexados por tipo" });
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Documentos indexados por tipo" })).getByText("commit")).toBeTruthy());
    confere("Conhecimento: fontes");
    await clicar(screen.getByRole("button", { name: "Apagar tudo…" }));
    await screen.findByRole("dialog", { name: "Apagar todo o conhecimento deste projeto?" });
    confere("Conhecimento: apagar tudo");
    await esc();
    await clicar(screen.getByRole("button", { name: "Importar histórico das CLIs…" }));
    await screen.findByRole("dialog", { name: "Importar histórico das CLIs" });
    confere("Conhecimento: importar histórico");
    await esc();
    await clicar(screen.getByRole("button", { name: "Esquecer documento Documento d1" }));
    await screen.findByRole("dialog", { name: "Esquecer do conhecimento?" });
    confere("Conhecimento: esquecer");
    await esc();

    await clicar(screen.getByRole("tab", { name: "Aprendizados" }));
    await screen.findByRole("list", { name: "Aprendizados" });
    confere("Conhecimento: aprendizados");
    await clicar(screen.getByRole("button", { name: "Editar Aprendizado a1" }));
    await screen.findByRole("dialog", { name: "Editar aprendizado" });
    confere("Conhecimento: editar aprendizado");
    await esc();

    await clicar(screen.getByRole("tab", { name: "Config" }));
    await screen.findByRole("switch", { name: "Conhecimento ligado" });
    await screen.findByText(/detectado em/);
    confere("Conhecimento: config");

    await clicar(screen.getByRole("tab", { name: "Backend" }));
    const prov = await screen.findByLabelText("Provedor");
    await act(async () => { fireEvent.change(prov, { target: { value: "supabase" } }); });
    await screen.findByText(/create extension/);
    confere("Conhecimento: backend (formulário)");
  });
});

describe("varredura de acessibilidade: Chat", () => {
  it("conversa com citações, plano proposto, edição do plano e estado de streaming", async () => {
    render(<App />);
    await ir("Chat");
    const lista = await screen.findByRole("list", { name: "Mensagens da conversa" });
    confere("Chat: conversa");
    await clicar(within(lista).getByRole("button", { name: /Fonte 1/ }));
    await within(lista).findByRole("region", { name: "Fonte 1" });
    confere("Chat: fonte aberta");
    await clicar(screen.getByRole("radio", { name: "Pedir ao orquestrador" }));
    const composer = screen.getByRole("textbox", { name: /Mensagem para/ });
    await act(async () => { fireEvent.change(composer, { target: { value: "preciso implementar X" } }); });
    await act(async () => { fireEvent.keyDown(composer, { key: "Enter" }); });
    const plano = await screen.findByRole("region", { name: /Plano:/ });
    confere("Chat: plano proposto");
    await clicar(within(plano).getByRole("button", { name: "Editar" }));
    await within(plano).findByRole("group", { name: "Editar o plano" });
    confere("Chat: edição do plano");
  });
});
