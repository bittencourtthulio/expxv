// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { PonteApp } from "../ponte";
import { criarStoreTema } from "./tema";

function apiFalsa(inicial: "claro" | "escuro") {
  let ouvinte: ((e: { preferencia: "claro" | "escuro" | "sistema"; efetivo: "claro" | "escuro" }) => void) | null = null;
  const tema = {
    ler: vi.fn(async () => ({ preferencia: "sistema" as const, efetivo: inicial })),
    definir: vi.fn(async (p: "claro" | "escuro" | "sistema") => ({ preferencia: p, efetivo: p === "sistema" ? inicial : p })),
    assinar: vi.fn((cb: typeof ouvinte) => {
      ouvinte = cb;
      return () => {
        ouvinte = null;
      };
    }),
  };
  return { api: { tema } as unknown as Pick<PonteApp, "tema">, emitir: (e: Parameters<NonNullable<typeof ouvinte>>[0]) => ouvinte?.(e), tema };
}

describe("store de tema", () => {
  it("sem API do main cai em prefers-color-scheme e aplica data-theme", () => {
    const store = criarStoreTema({ api: undefined, prefereEscuro: () => false, raiz: document.documentElement });
    expect(store.obter().efetivo).toBe("claro");
    store.iniciar();
    expect(document.documentElement.dataset.theme).toBe("claro");
  });

  it("alternar troca o tema sem recarregar e notifica assinantes", () => {
    const store = criarStoreTema({ api: undefined, prefereEscuro: () => true, raiz: document.documentElement });
    store.iniciar();
    const ouvinte = vi.fn();
    const cancelar = store.assinar(ouvinte);
    void store.alternar();
    expect(store.obter().efetivo).toBe("claro");
    expect(document.documentElement.dataset.theme).toBe("claro");
    expect(ouvinte).toHaveBeenCalled();
    cancelar();
  });

  it("com API do main: lê o tema salvo, persiste ao alternar e segue eventos do main", async () => {
    const { api, emitir, tema } = apiFalsa("escuro");
    const store = criarStoreTema({ api, prefereEscuro: () => false, raiz: document.documentElement });
    store.iniciar();
    await vi.waitFor(() => expect(tema.ler).toHaveBeenCalled());
    await vi.waitFor(() => expect(store.obter().efetivo).toBe("escuro"));
    await store.alternar();
    expect(tema.definir).toHaveBeenCalledWith("claro");
    expect(store.obter().efetivo).toBe("claro");
    emitir({ preferencia: "escuro", efetivo: "escuro" });
    expect(store.obter()).toEqual({ preferencia: "escuro", efetivo: "escuro" });
    expect(document.documentElement.dataset.theme).toBe("escuro");
  });
});
