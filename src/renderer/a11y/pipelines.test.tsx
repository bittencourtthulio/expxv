// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { storeMaestro } from "../estado/maestro";
import { storeRigidez } from "../estado/rigidez";
import { instalar, remover } from "./ade-falso";
import { formatar, varrer } from "./varredura";
import { irParaTela } from "./ir-menu";

// T-16.31/32: o seletor de rigidez está no topo de TODAS as telas e a tela Pipelines passa na varredura de acessibilidade.
beforeEach(() => { instalar(); storeMaestro._reiniciar(); storeRigidez._reiniciar(); });
afterEach(() => { cleanup(); remover(); vi.restoreAllMocks(); });
const ir = irParaTela;
const confere = (onde: string): void => { const a = varrer(document.body); expect(a.length === 0 ? "" : `${onde}\n${formatar(a)}`).toBe(""); };

describe("Maestro na casca", () => {
  it("o seletor de rigidez aparece no topo em cada tela e segue o workspace", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Hoje" });
    const s = await screen.findByRole("slider", { name: "Rigidez do método" });
    expect(s.closest("header")).not.toBeNull();
    for (const tela of ["Missões", "Squads", "Método", "Memória", "Pipelines", "Configurações"]) {
      await ir(tela);
      expect(screen.getAllByRole("slider", { name: "Rigidez do método" })).toHaveLength(1);
    }
  });

  it("a tela Pipelines (todas as abas) passa na varredura", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Hoje" });
    await ir("Pipelines");
    await screen.findByRole("list", { name: "Pipelines ativos" });
    confere("Pipelines: acompanhamento");
    for (const aba of ["Intenção", "Etapas", "Rigidez", "Provedores"]) {
      await act(async () => { fireEvent.click(screen.getByRole("tab", { name: aba })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      confere(`Pipelines: ${aba}`);
    }
  });

  it("'Pedir ao Maestro' pela paleta propõe o plano e leva à tela Pipelines, sem executar", async () => {
    const { maestro } = (await import("./ade-falso-maestro")).maestroFalso();
    render(<App />);
    await screen.findByRole("heading", { name: "Hoje" });
    const { pedirMaestro } = await import("../estado/maestro-acoes");
    const pedir = vi.spyOn((globalThis as unknown as { ade: { maestro: typeof maestro } }).ade.maestro, "pedir");
    const confirmar = vi.spyOn((globalThis as unknown as { ade: { maestro: typeof maestro } }).ade.maestro, "confirmar");
    await act(async () => { pedirMaestro(); });
    const campo = await screen.findByRole("textbox", { name: /O que você quer fazer/ });
    await act(async () => { fireEvent.change(campo, { target: { value: "corrige o erro ao salvar" } }); });
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    await screen.findByRole("region", { name: "Plano proposto" });
    expect(pedir).toHaveBeenCalledWith(expect.objectContaining({ via: "paleta", texto: "corrige o erro ao salvar", workspace_id: "w1" }));
    expect(confirmar).not.toHaveBeenCalled();
  });
});
