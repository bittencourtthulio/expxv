// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoSuite } from "../../compartilhado/suite";
import { PADRAO_DE_FABRICA } from "../../nucleo/suite/modulos";
import { App } from "../App";
import { PLANO, estadoModulos, estadoSuite, progresso } from "../estado/suite-fixtures";
import { instalar, remover, criarAdeFalso } from "./ade-falso";
import { irParaTela } from "./ir-menu";
import { formatar, varrer } from "./varredura";

// Varredura de acessibilidade da suíte ExpxDev: botão do cabeçalho, modal (requisitos, instalando, falha, sucesso), seção de módulos no Método e o padrão global nas Configurações.
const confere = (onde: string): void => {
  const achados = varrer(document.body);
  expect(achados.length === 0 ? "" : `${onde}\n${formatar(achados)}`).toBe("");
};
const clicar = async (el: HTMLElement): Promise<void> => { await act(async () => { fireEvent.click(el); }); };

let emitir: (e: EventoSuite) => void = () => undefined;
beforeEach(() => {
  // o app lê o estado da suíte em ocioso; no jsdom o `requestIdleCallback` não existe (cairia num timeout de 2 s)
  (globalThis as unknown as { requestIdleCallback: (f: () => void) => number }).requestIdleCallback = (f) => { f(); return 0; };
  instalar();
  const base = criarAdeFalso();
  const W = "w1";
  (globalThis as unknown as { ade: unknown }).ade = {
    ...base,
    suite: {
      estado: vi.fn(async () => estadoSuite("ausente", { workspace_id: W })),
      requisitos: vi.fn(async () => ({ ...PLANO, workspace_id: W })),
      instalar: vi.fn(async () => ({ instalacao_id: "suite_1" })),
      cancelar: vi.fn(async () => ({ ok: true })),
      dispensar: vi.fn(async () => estadoSuite("ausente", { workspace_id: W, dispensado: true })),
      assinar: (f: (e: EventoSuite) => void) => { emitir = f; return () => undefined; },
      modulosEstado: vi.fn(async () => estadoModulos(PADRAO_DE_FABRICA, { workspace_id: W })),
      modulosDefinir: vi.fn(async () => ({ ok: true, estado: estadoModulos(PADRAO_DE_FABRICA, { workspace_id: W }), mudou: [] })),
      modulosRestaurar: vi.fn(async () => estadoModulos(PADRAO_DE_FABRICA, { workspace_id: W })),
      modulosPadrao: vi.fn(async () => ({ modulos: { ...PADRAO_DE_FABRICA }, fabrica: { ...PADRAO_DE_FABRICA } })),
      modulosPadraoDefinir: vi.fn(async () => ({ modulos: { ...PADRAO_DE_FABRICA }, fabrica: { ...PADRAO_DE_FABRICA } })),
      assinarModulos: () => () => undefined,
    },
  };
  try { localStorage.clear(); } catch { /* sem storage */ }
});
afterEach(() => { cleanup(); remover(); vi.restoreAllMocks(); delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback; });

describe("acessibilidade da suíte ExpxDev", () => {
  it("cabeçalho com o botão em destaque, modal em cada fase, Método › Instalação › Módulos e Configurações", async () => {
    render(<App />);
    const botao = await screen.findByRole("button", { name: "Instalar suíte ExpxDev" });
    confere("cabeçalho com o botão Instalar suíte ExpxDev");
    await clicar(botao);
    const d = await screen.findByRole("dialog", { name: "Instalar a suíte ExpxDev" });
    await within(d).findByRole("list", { name: "Requisitos verificados" });
    confere("modal: passo 1 (requisitos)");
    await clicar(within(d).getByRole("button", { name: "Instalar agora" }));
    await act(async () => { emitir({ ...progresso("rodando", { workspace_id: "w1", percentual: 40 }) }); });
    await screen.findByRole("progressbar");
    confere("modal: instalando");
    await act(async () => { fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); });
    await screen.findByRole("alertdialog", { name: "Cancelar a instalação?" });
    confere("modal: confirmar cancelamento");
    await act(async () => { emitir({ ...progresso("falhou", { workspace_id: "w1", falha: { causa: "sem_internet", mensagem: "Sem conexão com a internet.", sugestao: "Confira sua conexão.", codigo: null, etapa: "baixando" }, situacao_projeto: "O projeto não foi alterado.", diagnostico: "x" }) }); });
    await screen.findByRole("alert");
    confere("modal: falha");
    await act(async () => { emitir({ ...progresso("concluida", { workspace_id: "w1", percentual: 100, resumo: { versao: "0.9.0", skills: ["sprintx", "runx"], criados: [".expx/expx-lock.json"], alterados: [], removidos: [], fora_do_esperado: [], truncado: false, doctor: "ok", backup: null, como_restaurar: null, restaurados: [] } }) }); });
    await screen.findByText(/Módulos ativados: 8 de 9/);
    confere("modal: sucesso com resumo de módulos");
    await clicar(screen.getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await irParaTela("Método");
    await screen.findByRole("heading", { name: "Método" });
    await clicar(await screen.findByRole("tab", { name: "Instalação" }));
    await screen.findByRole("list", { name: "Módulos" });
    confere("Método › Instalação › Módulos da suíte");
    expect(screen.getAllByRole("switch")).toHaveLength(9);

    await irParaTela("Configurações");
    await screen.findByRole("heading", { name: "Configurações" });
    await clicar(await screen.findByRole("tab", { name: "Módulos da suíte" }));
    await screen.findByRole("list", { name: "Módulos padrão" });
    confere("Configurações › Módulos da suíte");
  });
});
