// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { criarStoreConfig, validarConfig } from "./config";

function montar(inicial: Record<string, unknown> = {}) {
  const disco = new Map<string, unknown>(Object.entries(inicial));
  const api = { ler: vi.fn(async (k: string) => disco.get(k)), gravar: vi.fn(async (k: string, v: unknown) => { disco.set(k, v); return { ok: true as const }; }) };
  const raiz = document.createElement("html");
  return { disco, api, raiz, store: criarStoreConfig({ api: () => api, raiz }) };
}

describe("validarConfig", () => {
  it("scrollback: teto 50 000, inteiro, piso 500", () => {
    expect(validarConfig("scrollback", 50_000)).toBeNull();
    expect(validarConfig("scrollback", 50_001)).not.toBeNull();
    expect(validarConfig("scrollback", 499)).not.toBeNull();
    expect(validarConfig("scrollback", 1000.5)).not.toBeNull();
    expect(validarConfig("scrollback", Number.NaN)).not.toBeNull();
  });
  it("cor: hex de 6 dígitos ou null", () => {
    expect(validarConfig("cor", "#1d4ed8")).toBeNull();
    expect(validarConfig("cor", null)).toBeNull();
    for (const ruim of ["azul", "#fff", "#12345g", "1d4ed8", "#1d4ed8ff"]) expect(validarConfig("cor", ruim)).not.toBeNull();
  });
});

describe("store de configuração", () => {
  it("persiste, publica e rejeita fora de faixa sem gravar", async () => {
    const { store, api, disco } = montar();
    expect(await store.definir("scrollback", 10_000)).toEqual({ ok: true });
    expect(api.gravar).toHaveBeenCalledWith("terminal_scrollback", 10_000);
    expect(store.obter().scrollback).toBe(10_000);
    const r = await store.definir("scrollback", 60_000);
    expect(r.ok).toBe(false);
    expect(disco.get("terminal_scrollback")).toBe(10_000);
    expect(store.obter().scrollback).toBe(10_000);
  });
  it("cor aplica por setProperty, inválida é rejeitada e restaurar remove o override", async () => {
    const { store, raiz } = montar();
    await store.definir("cor", "#1d4ed8");
    expect(raiz.style.getPropertyValue("--destaque")).toBe("#1d4ed8");
    expect(raiz.style.getPropertyValue("--destaque-2")).toContain("#1d4ed8");
    expect((await store.definir("cor", "rosa")).ok).toBe(false);
    expect(raiz.style.getPropertyValue("--destaque")).toBe("#1d4ed8");
    expect(await store.restaurarCor()).toEqual({ ok: true });
    expect(raiz.style.getPropertyValue("--destaque")).toBe("");
    expect(store.obter().cor).toBeNull();
  });
  it("iniciar lê tudo em paralelo, aplica a cor salva e ignora lixo do disco", async () => {
    const { store, raiz } = montar({ cor_destaque: "#0284c7", terminal_scrollback: 999_999, permissao_padrao: "automatico" });
    await store.iniciar();
    const e = store.obter();
    expect(e.carregado).toBe(true);
    expect(e.scrollback).toBe(5_000);
    expect(e.permissaoPadrao).toBe("automatico");
    expect(raiz.style.getPropertyValue("--destaque")).toBe("#0284c7");
  });
  it("falha de gravação devolve erro e não publica", async () => {
    const { store, api } = montar();
    api.gravar.mockRejectedValueOnce(new Error("disco cheio"));
    const r = await store.definir("notificacoes", false);
    expect(r.ok).toBe(false);
    expect(store.obter().notificacoes).toBe(true);
  });
});
