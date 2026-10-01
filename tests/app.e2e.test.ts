import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirApp } from "./fixture";
import type { AppAberto } from "./fixture";

let a: AppAberto;

beforeAll(async () => {
  a = await abrirApp();
});
afterAll(async () => {
  await a.fechar();
});

describe("casca do app (Electron real)", () => {
  it("abre a janela com a casca e o menu lateral", async () => {
    await a.pagina.waitForSelector("nav", { timeout: 15000 });
    expect(await a.pagina.title()).not.toBe("");
    expect(await a.pagina.locator("nav button").count()).toBeGreaterThanOrEqual(7);
  });

  it("expõe só window.ade (API enumerada) e nada de Node no renderer", async () => {
    const r = await a.pagina.evaluate(() => ({
      chaves: Object.keys((window as unknown as { ade: object }).ade).sort(),
      temRequire: typeof (window as unknown as { require?: unknown }).require,
      temProcess: typeof (window as unknown as { process?: unknown }).process,
    }));
    expect(r.chaves).toEqual(["agentes", "cofre", "config", "harness", "limites", "menu", "metodo", "missoes", "openrouter", "perf", "provedores", "squads", "tema", "terminais", "versao", "workspaces"]);
    expect(r.temRequire).toBe("undefined");
    expect(r.temProcess).toBe("undefined");
  });

  it("IPC responde: versão e tema", async () => {
    const r = await a.pagina.evaluate(async () => {
      const ade = (window as unknown as { ade: { versao(): Promise<string>; tema: { ler(): Promise<{ efetivo: string }> } } }).ade;
      return { versao: await ade.versao(), tema: (await ade.tema.ler()).efetivo };
    });
    expect(r.versao).toMatch(/^\d+\.\d+\.\d+/);
    expect(["claro", "escuro"]).toContain(r.tema);
  });

  it("troca o tema sem recarregar a página", async () => {
    const marca = await a.pagina.evaluate(() => {
      (window as unknown as { __marca: number }).__marca = 42;
      return document.documentElement.getAttribute("data-theme");
    });
    const alvo = marca === "escuro" ? "claro" : "escuro";
    await a.pagina.evaluate(async (t) => {
      await (window as unknown as { ade: { tema: { definir(p: string): Promise<unknown> } } }).ade.tema.definir(t);
    }, alvo);
    await a.pagina.waitForFunction((t) => document.documentElement.getAttribute("data-theme") === t, alvo, { timeout: 5000 });
    expect(await a.pagina.evaluate(() => (window as unknown as { __marca: number }).__marca)).toBe(42);
  });

  it("recusa navegação para fora do scheme próprio", async () => {
    const antes = a.pagina.url();
    await a.pagina.evaluate(() => {
      window.location.href = "https://example.com/";
    });
    await a.pagina.waitForTimeout(500);
    expect(a.pagina.url()).toBe(antes);
  });
});
