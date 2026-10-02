// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ESTADO_RIGIDEZ, maestroFalso } from "../a11y/ade-falso-maestro";
import { instalar, remover } from "../a11y/ade-falso";
import { criarStoreRigidez } from "../estado/rigidez";
import { SeletorRigidez } from "./SeletorRigidez";

beforeEach(() => { instalar(); });
afterEach(() => { cleanup(); remover(); vi.restoreAllMocks(); });

async function montar(sobre: Parameters<typeof maestroFalso>[0] = {}, props: { missionId?: string | null } = {}) {
  const api = maestroFalso(sobre).rigidez;
  const store = criarStoreRigidez({ api: () => api, quadro: (f) => f() });
  await act(async () => { render(<SeletorRigidez store={store} workspaceId="w1" {...props} />); });
  return { api, store };
}
const slider = () => screen.getByRole("slider", { name: "Rigidez do método" });

describe("SeletorRigidez", () => {
  it("expõe role=slider com valores e aria-valuetext 'Padrão, nível 3 de 5', número e nome visíveis", async () => {
    await montar();
    const s = slider();
    expect(s.getAttribute("aria-valuemin")).toBe("1");
    expect(s.getAttribute("aria-valuemax")).toBe("5");
    expect(s.getAttribute("aria-valuenow")).toBe("3");
    expect(s.getAttribute("aria-valuetext")).toBe("Padrão, nível 3 de 5");
    expect(s.tabIndex).toBe(0);
    expect(screen.getByText("N3")).toBeTruthy();
    expect(screen.getByText("Padrão")).toBeTruthy();
  });

  it("setas, Home e End mudam o nível na hora e gravam depois do atraso (uma chamada só)", async () => {
    const definir = vi.fn(async (p: { nivel: number }) => ({ efetivo: p.nivel as never, hooks: { escrito: false, agendado: false, arquivo: null, aviso: null }, estado: { ...ESTADO_RIGIDEZ, efetivo: p.nivel as never } }));
    await montar({ rigidez: { definir } });
    await act(async () => { fireEvent.keyDown(slider(), { key: "ArrowRight" }); });
    expect(slider().getAttribute("aria-valuetext")).toBe("Rigoroso, nível 4 de 5");
    await act(async () => { fireEvent.keyDown(slider(), { key: "ArrowRight" }); });
    expect(slider().getAttribute("aria-valuenow")).toBe("5");
    await act(async () => { fireEvent.keyDown(slider(), { key: "Home" }); });
    expect(slider().getAttribute("aria-valuenow")).toBe("1");
    await waitFor(() => expect(definir).toHaveBeenCalledTimes(1));
    expect(definir.mock.calls[0]?.[0]).toMatchObject({ workspace_id: "w1", escopo: "workspace", nivel: 1 });
    await act(async () => { fireEvent.keyDown(slider(), { key: "End" }); });
    await waitFor(() => expect(definir).toHaveBeenCalledTimes(2));
    expect(definir.mock.calls[1]?.[0]).toMatchObject({ nivel: 5 });
  });

  it("pedido externo (Método › Ativar proteções) abre os detalhes com a prévia dos hooks; o pedido antigo não reabre ao montar", async () => {
    const { store } = await montar();
    expect(screen.queryByRole("group", { name: "Detalhes da rigidez" })).toBeNull();
    await act(async () => { store.pedirAbrir(); });
    expect(screen.getByRole("group", { name: "Detalhes da rigidez" })).toBeTruthy();
    expect(screen.getByLabelText("Prévia dos hooks")).toBeTruthy();
    cleanup();
    await act(async () => { render(<SeletorRigidez store={store} workspaceId="w1" />); });
    expect(screen.queryByRole("group", { name: "Detalhes da rigidez" })).toBeNull();
  });

  it("Enter abre o popover com a descrição ligado/desligado, escopos e a prévia dos hooks; Esc fecha e devolve o foco", async () => {
    await montar();
    slider().focus();
    await act(async () => { fireEvent.keyDown(slider(), { key: "Enter" }); });
    const pop = await screen.findByRole("group", { name: "Detalhes da rigidez" });
    expect(await screen.findByText(/todas as etapas/)).toBeTruthy();
    expect(pop.textContent).toContain("Ligado:");
    expect(pop.textContent).toContain("Desligado:");
    expect(screen.getByRole("radio", { name: "Workspace" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Esta Missão" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: "Só este pedido" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Voltar ao padrão ao fim")).toBeTruthy();
    expect(await screen.findByText(/1 hook\(s\) gerenciado\(s\)/)).toBeTruthy();
    await act(async () => { fireEvent.keyDown(pop, { key: "Escape" }); });
    expect(screen.queryByRole("group", { name: "Detalhes da rigidez" })).toBeNull();
    expect(document.activeElement).toBe(slider());
  });

  it("escopo 'Esta Missão' só existe com Missão em foco e vai no pedido", async () => {
    const definir = vi.fn(async (p: { nivel: number }) => ({ efetivo: p.nivel as never, hooks: { escrito: false, agendado: false, arquivo: null, aviso: null }, estado: { ...ESTADO_RIGIDEZ, efetivo: p.nivel as never } }));
    await montar({ rigidez: { definir } }, { missionId: "m1" });
    await act(async () => { fireEvent.keyDown(slider(), { key: "Enter" }); });
    await act(async () => { fireEvent.click(await screen.findByRole("radio", { name: "Esta Missão" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Aplicar neste escopo" })); });
    await waitFor(() => expect(definir).toHaveBeenCalled());
    expect(definir.mock.calls.at(-1)?.[0]).toMatchObject({ escopo: "missao", mission_id: "m1" });
  });

  it("confirmacao_necessaria do main abre o diálogo e só envia com a frase 'baixar'", async () => {
    const definir = vi.fn()
      .mockRejectedValueOnce(new Error("confirmacao_necessaria: o alvo está em main"))
      .mockImplementation(async (p: { nivel: number }) => ({ efetivo: p.nivel, hooks: { escrito: false, agendado: false, arquivo: null, aviso: null }, estado: { ...ESTADO_RIGIDEZ, efetivo: p.nivel } }));
    await montar({ rigidez: { definir } });
    await act(async () => { fireEvent.keyDown(slider(), { key: "ArrowLeft" }); });
    await act(async () => { fireEvent.keyDown(slider(), { key: "ArrowLeft" }); });
    const dlg = await screen.findByRole("dialog", { name: "Confirmar rigidez baixa" });
    expect(dlg.textContent).toContain("o alvo está em main");
    const confirmar = screen.getByRole("button", { name: "Confirmar" }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    const campo = screen.getByRole("textbox");
    await act(async () => { fireEvent.change(campo, { target: { value: "baixa" } }); });
    expect(confirmar.disabled).toBe(true);
    await act(async () => { fireEvent.change(campo, { target: { value: "baixar" } }); });
    expect(confirmar.disabled).toBe(false);
    await act(async () => { fireEvent.click(confirmar); });
    await waitFor(() => expect(definir).toHaveBeenCalledTimes(2));
    expect(definir.mock.calls[1]?.[0]).toMatchObject({ nivel: 1, confirmacao_digitada: "baixar" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("abaixo do mínimo travado pede justificativa de 20+ caracteres ANTES de chamar o main", async () => {
    const definir = vi.fn(async (p: { nivel: number }) => ({ efetivo: p.nivel as never, hooks: { escrito: false, agendado: false, arquivo: null, aviso: null }, estado: { ...ESTADO_RIGIDEZ, efetivo: p.nivel as never } }));
    await montar({ rigidez: { definir, ler: async () => ({ ...ESTADO_RIGIDEZ, efetivo: 4, minimo_travado: 4, motivo_trava: "Raio ALTO em legadox" }) } });
    await act(async () => { fireEvent.keyDown(slider(), { key: "ArrowLeft" }); });
    await screen.findByRole("dialog", { name: "Justificar nível abaixo do mínimo" });
    expect(definir).not.toHaveBeenCalled();
    const enviar = screen.getByRole("button", { name: "Confirmar" }) as HTMLButtonElement;
    await act(async () => { fireEvent.change(screen.getByRole("textbox"), { target: { value: "curta demais" } }); });
    expect(enviar.disabled).toBe(true);
    await act(async () => { fireEvent.change(screen.getByRole("textbox"), { target: { value: "Correção urgente de produção aprovada pelo dono" } }); });
    expect(enviar.disabled).toBe(false);
    await act(async () => { fireEvent.click(enviar); });
    await waitFor(() => expect(definir).toHaveBeenCalledTimes(1));
    expect(definir.mock.calls[0]?.[0]).toMatchObject({ nivel: 3, justificativa: "Correção urgente de produção aprovada pelo dono" });
  });

  it("sem canal (fora do aplicativo) o seletor nem aparece", async () => {
    const api = { ...maestroFalso().rigidez, ler: undefined } as never;
    const store = criarStoreRigidez({ api: () => api, quadro: (f) => f() });
    await act(async () => { render(<SeletorRigidez store={store} workspaceId="w1" />); });
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("evento rigidez:evento relê o nível sem recarregar a tela", async () => {
    let emitir: (e: { workspace_id: string; mission_id: null; nivel: 2; escopo: "workspace" }) => void = () => undefined;
    let nivel: 2 | 3 = 3;
    await montar({ rigidez: { ler: async () => ({ ...ESTADO_RIGIDEZ, efetivo: nivel }), assinar: (cb) => { emitir = cb as never; return () => undefined; } } });
    expect(slider().getAttribute("aria-valuenow")).toBe("3");
    nivel = 2;
    await act(async () => { emitir({ workspace_id: "w1", mission_id: null, nivel: 2, escopo: "workspace" }); });
    await waitFor(() => expect(slider().getAttribute("aria-valuenow")).toBe("2"));
  });
});
