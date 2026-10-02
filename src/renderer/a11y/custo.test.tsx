// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { instalar, remover } from "./ade-falso";
import { formatar, varrer } from "./varredura";
import { irParaTela } from "./ir-menu";
import { pedirCusto } from "../estado/custo-acoes";

// T-10.30: varredura de acessibilidade da aba Board (Missões) e das abas de custo do Consumo, com `ade()` falso.
const confere = (onde: string): void => { const a = varrer(document.body); expect(a.length === 0 ? "" : `${onde}\n${formatar(a)}`).toBe(""); };
const ir = irParaTela;

beforeEach(() => { instalar(); });
afterEach(() => { cleanup(); remover(); vi.restoreAllMocks(); });

describe("varredura de acessibilidade: custo e board", () => {
  it("Missões › Board: seis colunas, card, detalhe e custo", async () => {
    render(<App />);
    await ir("Missões");
    await screen.findByRole("heading", { name: "Quadro" });
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Board" })); });
    await screen.findByRole("region", { name: /^Validado/ });
    expect(screen.getAllByRole("region").filter((r) => /, \d+ cards?/.test(r.getAttribute("aria-label") ?? "")).length).toBe(6);
    confere("Board");
    await act(async () => { fireEvent.click(screen.getByRole("article", { name: /^T-03/ })); });
    await screen.findByRole("complementary", { name: "Detalhe de T-03" });
    await screen.findByText("Fazer o login");
    confere("Board com detalhe");
  });
  it("paleta pede o board (abre a aba) e o detalhe de uso (abre a aba do Consumo)", async () => {
    render(<App />);
    await ir("Missões");
    await screen.findByRole("heading", { name: "Quadro" });
    await act(async () => { pedirCusto("board"); });
    await screen.findByRole("region", { name: /^Validado/ });
    await ir("Consumo");
    await act(async () => { pedirCusto("detalhe"); });
    await screen.findByRole("tab", { name: "Detalhe por uso", selected: true }, { timeout: 5000 });
    await screen.findByRole("list", { name: "Uso por modelo" });
    confere("Consumo: detalhe por uso");
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Fontes e preços" })); });
    await screen.findByRole("region", { name: "Fontes de uso" });
    confere("Consumo: fontes e preços");
  });
});
