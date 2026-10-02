// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiMemoria } from "../../../compartilhado/memoria";
import { ESTADO_MEMORIA, memoriaFalso } from "../../a11y/ade-falso-memoria";
import { instalar, remover } from "../../a11y/ade-falso";
import { criarStoreMemoria } from "../../estado/memoria";
import { storeWorkspaces } from "../../estado/workspaces";
import { SecaoDiagnostico } from "./Secoes";
import { SecaoMemoria } from "./SecaoMemoria";

beforeEach(async () => { instalar(); await storeWorkspaces.iniciar(); });
afterEach(() => { cleanup(); remover(); vi.restoreAllMocks(); });

async function montar(sobre: Partial<ApiMemoria> = {}) {
  const api = memoriaFalso(sobre);
  const store = criarStoreMemoria({ api: () => api, avisar: () => undefined, quadro: (f) => f() });
  await act(async () => { render(<SecaoMemoria store={store} />); });
  await screen.findByRole("switch", { name: /Memória neste computador/ });
  return { api, store };
}

describe("Configurações → Memória (T-08.22)", () => {
  it("texto fixo de privacidade, chaves e contagem/tamanho", async () => {
    await montar();
    expect(screen.getByText("Fica só neste computador. Segredos são mascarados antes de gravar.")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Memória em Missões agênticas: ligada" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Memória em painéis livres: desligada" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Memória das squads: ligada/ })).toBeTruthy();
    expect(screen.getByText(/4 entradas em 4,0 KB de 512 MB/)).toBeTruthy();
  });

  it("alterar persiste pelo canal (global, projeto, solo, squad, pacote)", async () => {
    const gravarConfig = vi.fn(async (p: object) => ({ ...ESTADO_MEMORIA.config, ...p }));
    await montar({ gravarConfig: gravarConfig as never });
    await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "Memória em painéis livres: desligada" })); });
    expect(gravarConfig).toHaveBeenCalledWith({ workspace_id: "w1", solo: true });
    await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "Memória em Missões agênticas: ligada" })); });
    expect(gravarConfig).toHaveBeenCalledWith({ workspace_id: "w1", ativa: false });
    await act(async () => { fireEvent.click(screen.getByRole("switch", { name: /Memória neste computador/ })); });
    expect(gravarConfig).toHaveBeenCalledWith({ workspace_id: "w1", global_ativa: false });
  });

  it("chave geral desligada desabilita as demais (preserva dados, não coleta)", async () => {
    await montar({ estado: async () => ({ ...ESTADO_MEMORIA, config: { ...ESTADO_MEMORIA.config, global_ativa: false } }) });
    expect((screen.getByRole("switch", { name: /Memória em Missões agênticas/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/nada é coletado e nada é apagado/)).toBeTruthy();
  });

  it("retenção valida (0 = sem limite; 7–3650) e só grava valor válido", async () => {
    const gravarConfig = vi.fn(async (p: object) => ({ ...ESTADO_MEMORIA.config, ...p }));
    await montar({ gravarConfig: gravarConfig as never });
    const campo = screen.getByLabelText("Retenção (dias)");
    fireEvent.change(campo, { target: { value: "3" } });
    await act(async () => { fireEvent.blur(campo); });
    expect(screen.getByRole("alert").textContent).toMatch(/0 \(sem limite\) ou de 7 a 3650/);
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    expect(gravarConfig).not.toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: "0" } });
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    expect(gravarConfig).toHaveBeenCalledWith({ workspace_id: "w1", retencao_dias: 0 });
  });

  it("orçamento do brief fora de 1500–20000 é recusado; teto e embedding gravam", async () => {
    const gravarConfig = vi.fn(async (p: object) => ({ ...ESTADO_MEMORIA.config, ...p }));
    await montar({ gravarConfig: gravarConfig as never });
    const orc = screen.getByLabelText("Orçamento do brief (caracteres)");
    fireEvent.change(orc, { target: { value: "900" } });
    await act(async () => { fireEvent.blur(orc); });
    expect(screen.getByRole("alert").textContent).toMatch(/entre 1500 e 20000/);
    fireEvent.change(orc, { target: { value: "8000" } });
    await act(async () => { fireEvent.blur(orc); });
    expect(gravarConfig).toHaveBeenCalledWith({ workspace_id: "w1", orcamento_brief_chars: 8000 });
    await act(async () => { fireEvent.change(screen.getByLabelText("Busca semântica local"), { target: { value: "hash-256-v1" } }); });
    expect(gravarConfig).toHaveBeenCalledWith({ workspace_id: "w1", embedding_modelo: "hash-256-v1" });
  });

  it("Apagar memória deste projeto: diálogo da UI com o nome digitado (nunca window.confirm)", async () => {
    const confirmar = vi.spyOn(window, "confirm");
    const purgar = vi.fn(async () => ({ removidas: 4 }));
    await montar({ purgar });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apagar memória deste projeto" })); });
    const d = screen.getByRole("dialog", { name: "Apagar a memória deste projeto?" });
    const apagar = within(d).getByRole("button", { name: "Apagar tudo" }) as HTMLButtonElement;
    expect(apagar.disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText("Digite o nome do projeto para confirmar"), { target: { value: "w" } });
    expect(apagar.disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText("Digite o nome do projeto para confirmar"), { target: { value: "w1" } });
    await act(async () => { fireEvent.click(apagar); });
    expect(purgar).toHaveBeenCalledWith({ workspace_id: "w1", escopo: "tudo", confirmacao: "w1" });
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("estados: carregando/erro/indisponível", async () => {
    const api = memoriaFalso({ estado: async () => { throw new Error("banco fechado"); } });
    const store = criarStoreMemoria({ api: () => api, avisar: () => undefined });
    await act(async () => { render(<SecaoMemoria store={store} />); });
    expect((await screen.findByRole("alert")).textContent).toContain("banco fechado");
    cleanup();
    const sem = criarStoreMemoria({ api: () => undefined });
    await act(async () => { render(<SecaoMemoria store={sem} />); });
    expect(screen.getByText(/não está disponível fora do aplicativo/)).toBeTruthy();
  });
});

describe("diagnóstico copiável inclui as métricas da memória (T-08.20)", () => {
  it("só números e sim/não; nunca conteúdo, e o bloco é opcional", async () => {
    await act(async () => { render(<SecaoDiagnostico />); });
    (globalThis as unknown as { ade: { terminais: { diagnostico: () => Promise<{ texto: string }> } } }).ade.terminais = { diagnostico: async () => ({ texto: "ExpxV 0.0.0" }) } as never;
    (globalThis as unknown as { ade: { memoria: ApiMemoria } }).ade.memoria = memoriaFalso();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gerar diagnóstico" })); });
    const t = (screen.getByLabelText("Texto do diagnóstico") as HTMLTextAreaElement).value;
    expect(t).toContain("ExpxV 0.0.0");
    expect(t).toContain("Memória:\n  entradas.pane=2");
    expect(t).toContain("memoria.dedupe=2");
    expect(t).toContain("fts5=sim");
    expect(t).not.toMatch(/Decisão mem_/);
    cleanup();
    // sem o canal da memória, o diagnóstico segue sem o bloco
    delete (globalThis as unknown as { ade: { memoria?: unknown } }).ade.memoria;
    await act(async () => { render(<SecaoDiagnostico />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gerar diagnóstico" })); });
    expect((screen.getByLabelText("Texto do diagnóstico") as HTMLTextAreaElement).value).toBe("ExpxV 0.0.0");
  });
});
