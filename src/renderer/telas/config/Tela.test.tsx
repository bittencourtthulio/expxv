// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { criarStoreConfig, useConfig, type StoreConfig } from "../../estado/config";
import { TelaConfig } from "./index";

function montar(inicial: Record<string, unknown> = {}) {
  const disco = new Map<string, unknown>(Object.entries(inicial));
  const api = { ler: vi.fn(async (k: string) => disco.get(k)), gravar: vi.fn(async (k: string, v: unknown) => { disco.set(k, v); return { ok: true as const }; }) };
  const raiz = document.createElement("html");
  const store = criarStoreConfig({ api: () => api, raiz });
  return { api, disco, raiz, store };
}
async function abrir(store: StoreConfig) {
  await act(async () => { render(<TelaConfig store={store} />); });
}
const clicar = async (nome: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: nome })); }); };

describe("Tela de configurações", () => {
  it("scrollback persiste e fora de faixa é rejeitado na tela", async () => {
    const { store, api } = montar();
    await abrir(store);
    const campo = screen.getByLabelText("Scrollback do terminal, valor");
    fireEvent.change(campo, { target: { value: "20000" } });
    await act(async () => { fireEvent.submit(campo.closest("form")!); });
    expect(api.gravar).toHaveBeenCalledWith("terminal_scrollback", 20_000);
    fireEvent.change(campo, { target: { value: "50001" } });
    await act(async () => { fireEvent.submit(campo.closest("form")!); });
    expect(screen.getByRole("alert").textContent).toMatch(/entre 500 e 50\.000/);
    expect(api.gravar).toHaveBeenCalledTimes(1);
  });
  it("cor inválida é rejeitada; válida aplica sem recarregar; restaurar padrão limpa", async () => {
    const { store, raiz } = montar();
    await abrir(store);
    const campo = screen.getByLabelText("Cor de destaque (hex)");
    fireEvent.change(campo, { target: { value: "verde" } });
    await clicar("Aplicar");
    expect(screen.getByRole("alert").textContent).toMatch(/Cor inválida/);
    expect(raiz.style.getPropertyValue("--destaque")).toBe("");
    fireEvent.change(campo, { target: { value: "#0284c7" } });
    await clicar("Aplicar");
    expect(raiz.style.getPropertyValue("--destaque")).toBe("#0284c7");
    await clicar("Restaurar padrão");
    expect(raiz.style.getPropertyValue("--destaque")).toBe("");
    expect((screen.getByLabelText("Cor de destaque (hex)") as HTMLInputElement).value).toBe("");
  });
  it("modo automático mostra aviso e só grava depois da confirmação", async () => {
    const { store, api } = montar();
    await abrir(store);
    await clicar("Automático");
    expect(screen.getByRole("alert").textContent).toMatch(/sem pedir sua confirmação/);
    expect(api.gravar).not.toHaveBeenCalled();
    await clicar("Entendi, ativar automático");
    expect(api.gravar).toHaveBeenCalledWith("permissao_padrao", "automatico");
    await clicar("Seguro");
    expect(api.gravar).toHaveBeenLastCalledWith("permissao_padrao", "seguro");
  });
  it("notificações ligam e desligam", async () => {
    const { store, api } = montar();
    await abrir(store);
    await act(async () => { fireEvent.click(screen.getByRole("switch")); });
    expect(api.gravar).toHaveBeenCalledWith("notificacoes", false);
  });
  it("tema troca na hora pela preferência", async () => {
    const { store } = montar();
    await abrir(store);
    await clicar("Escuro");
    expect(document.documentElement.dataset.theme).toBe("escuro");
    await clicar("Claro");
    expect(document.documentElement.dataset.theme).toBe("claro");
  });
  it("diagnóstico é gerado por terminais.diagnostico e copiado", async () => {
    const { store } = montar();
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    (globalThis as { ade?: unknown }).ade = { terminais: { diagnostico: vi.fn().mockResolvedValue({ texto: "diag: ok" }) }, versao: vi.fn().mockResolvedValue("1.2.3") };
    try {
      await abrir(store);
      await clicar("Gerar diagnóstico");
      expect((screen.getByLabelText("Texto do diagnóstico") as HTMLTextAreaElement).value).toBe("diag: ok");
      await clicar("Copiar");
      expect(escrever).toHaveBeenCalledWith("diag: ok");
      expect(screen.getByText("1.2.3")).toBeTruthy();
    } finally { delete (globalThis as { ade?: unknown }).ade; }
  });
  it("atalhos aparecem em tabela somente leitura", async () => {
    const { store } = montar();
    await abrir(store);
    expect(screen.getByText("Paleta de comandos")).toBeTruthy();
    expect(screen.getByText("⌘K")).toBeTruthy();
    expect(screen.getByText("Ctrl+Shift+P")).toBeTruthy();
  });
});

describe("troca de cor não re-renderiza quem não depende dela", () => {
  it("componente que só lê scrollback não renderiza de novo ao mudar a cor", async () => {
    const { store } = montar();
    let renders = 0;
    function Irmao() {
      renders++;
      const n = useConfig((e) => e.scrollback, store);
      useRef(null);
      return <span>{n}</span>;
    }
    await act(async () => { render(<><Irmao /><TelaConfig store={store} /></>); });
    const antes = renders;
    await act(async () => { await store.definir("cor", "#0284c7"); });
    await act(async () => { await store.definir("cor", "#1d4ed8"); });
    expect(renders).toBe(antes);
    await act(async () => { await store.definir("scrollback", 7_000); });
    expect(renders).toBe(antes + 1);
  });
});
