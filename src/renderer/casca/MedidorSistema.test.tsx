// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AmostraSistema, DetalheSistema } from "../../compartilhado/sistema";
import { criarStoreSistema, type StoreSistema } from "../estado/sistema";
import { fecharPopoverLimites, abrirPopoverLimites } from "../estado/popover-limites";
import { MedidorSistema } from "./MedidorSistema";

const DETALHE: DetalheSistema = {
  cpu_total: 40, nucleos: Array.from({ length: 20 }, (_, i) => i * 5), ram: { pct: 61, usada_mb: 9000, total_mb: 16000, disponivel_mb: 7000 }, swap: { usado_mb: 100, total_mb: 2000 },
  app: { cpu: 5, mem_mb: 800, processos: [{ nome: "Principal", origem: "app", sessao: null, cpu: 2, mem_mb: 300 }] },
  agentes: { cpu: 30, mem_mb: 700, sessoes: [{ rotulo: "Claude Code", processos: 3, cpu: 30, mem_mb: 700 }] },
  top_cpu: [{ nome: "claude", origem: "agente", sessao: "Claude Code", cpu: 30, mem_mb: 500 }],
  top_mem: [{ nome: "Interface", origem: "app", sessao: null, cpu: 3, mem_mb: 400 }],
};

async function montar(opcoes: { mostrar?: boolean } = {}) {
  let emitir: (a: AmostraSistema) => void = () => undefined;
  const detalhe = vi.fn(async (aberto: boolean) => (aberto ? DETALHE : null));
  const api = { assinar: vi.fn(async (ativo: boolean) => ({ ativo })), detalhe, aoAmostra: vi.fn((cb: (a: AmostraSistema) => void) => { emitir = cb; return () => undefined; }) };
  const config = { ler: vi.fn(async () => (opcoes.mostrar === false ? false : null)), gravar: vi.fn(async () => ({ ok: true as const })) };
  (globalThis as unknown as { ade: unknown }).ade = { sistema: api, config };
  const store: StoreSistema = criarStoreSistema({ api: () => api as never, config: () => config as never });
  await act(async () => { render(<MedidorSistema store={store} />); });
  await act(async () => { await store.iniciar(); });
  const amostra = (a: AmostraSistema) => act(async () => { emitir(a); });
  return { store, api, config, amostra, detalhe };
}

afterEach(() => { cleanup(); fecharPopoverLimites(); delete (globalThis as { ade?: unknown }).ade; vi.useRealTimers(); });

describe("chip de CPU e memória", () => {
  it("mostra CPU e RAM com número sempre visível, barras de 3 px por largura e aria-label com os números", async () => {
    const m = await montar();
    await m.amostra({ cpu: 23, ram: 61 });
    const chip = screen.getByRole("button", { name: "CPU 23 por cento, memória 61 por cento" });
    expect(chip.textContent).toContain("23%");
    expect(chip.textContent).toContain("61%");
    expect(chip.textContent).toContain("CPU");
    expect(chip.textContent).toContain("RAM");
    const barras = [...chip.querySelectorAll<HTMLElement>(".sis-barra b")].map((b) => b.style.width);
    expect(barras).toEqual(["23%", "61%"]);
    expect(chip.getAttribute("aria-haspopup")).toBe("dialog");
    expect(chip.getAttribute("data-tom")).toBe("normal");
  });

  it("limiares: âmbar ≥ 80 e vermelho ≥ 92 por item, com sinal textual no chip; o número continua lá", async () => {
    const m = await montar();
    await m.amostra({ cpu: 85, ram: 95 });
    const chip = screen.getByRole("button", { name: /CPU 85/ });
    const itens = chip.querySelectorAll(".sis-item");
    expect(itens[0]!.getAttribute("data-tom")).toBe("aviso");
    expect(itens[1]!.getAttribute("data-tom")).toBe("alerta");
    expect(chip.getAttribute("data-tom")).toBe("alerta");
    expect(chip.querySelector(".sis-sinal")?.textContent).toBe("!");
    expect(itens[0]!.textContent).toContain("85%");
    expect(itens[1]!.textContent).toContain("95%");
  });

  it("antes da primeira amostra mostra — (nunca 0 falso)", async () => {
    await montar();
    expect(screen.getByRole("button", { name: /aguardando/ }).textContent).toContain("—");
  });

  it("região viva separada: não anuncia por amostra, só ao cruzar limiar", async () => {
    const m = await montar();
    const viva = () => document.querySelector('[role="status"]')!.textContent;
    await m.amostra({ cpu: 10, ram: 10 });
    await m.amostra({ cpu: 20, ram: 10 });
    expect(viva()).toBe("");
    await m.amostra({ cpu: 85, ram: 10 });
    expect(viva()).toBe("Atenção: CPU em 85 por cento.");
    await m.amostra({ cpu: 86, ram: 10 });
    expect(viva()).toBe("Atenção: CPU em 85 por cento."); // não mudou: sem novo anúncio
    expect(document.querySelector(".sis-chip")!.getAttribute("aria-live")).toBeNull();
  });

  it("oculto pela preferência: nada renderiza e o main não é assinado", async () => {
    const m = await montar({ mostrar: false });
    expect(screen.queryByRole("button", { name: /CPU/ })).toBeNull();
    expect(m.api.assinar).not.toHaveBeenCalled();
  });

  it("sem a API do preload: não renderiza nada (navegador/teste)", async () => {
    const store = criarStoreSistema({ api: () => undefined, config: () => undefined });
    await act(async () => { render(<MedidorSistema store={store} />); });
    expect(document.querySelector(".sis-chip")).toBeNull();
  });
});

describe("popover do medidor", () => {
  it("abre com role=dialog não modal, mostra CPU por núcleo (máx. 16 + 'e mais N'), memória, swap, app, agentes e tops", async () => {
    const m = await montar();
    await m.amostra({ cpu: 40, ram: 61 });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /CPU 40/ })); });
    await act(async () => { await Promise.resolve(); });
    const dlg = screen.getByRole("dialog", { name: "CPU e memória da máquina" });
    expect(dlg.getAttribute("aria-modal")).toBe("false");
    expect(m.detalhe).toHaveBeenCalledWith(true);
    expect(within(dlg).getByRole("group", { name: "CPU por núcleo" }).querySelectorAll(".sis-nucleo")).toHaveLength(16);
    expect(within(dlg).getByText("e mais 4")).toBeTruthy();
    expect(dlg.textContent).toContain("em uso 8,8 GB de 15,6 GB");
    expect(dlg.textContent).toContain("swap 100 MB de 2,0 GB");
    expect(within(dlg).getByRole("region", { name: "Este app" }).textContent).toContain("Principal");
    expect(within(dlg).getByRole("region", { name: "Agentes" }).textContent).toContain("Claude Code");
    expect(within(dlg).getByRole("region", { name: "Top 5 por CPU" }).textContent).toContain("claude");
    expect(within(dlg).getByRole("region", { name: "Top 5 por memória" }).textContent).toContain("Interface");
    expect(dlg.textContent).not.toMatch(/\/Users|--token/);
  });

  it("Esc fecha, avisa o main (detalhe(false)) e devolve o foco ao chip", async () => {
    const m = await montar();
    await m.amostra({ cpu: 40, ram: 61 });
    const chip = screen.getByRole("button", { name: /CPU 40/ });
    chip.focus();
    await act(async () => { fireEvent.click(chip); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "Escape" }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(m.detalhe).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(chip);
  });

  it("renova o detalhe a cada 2 s só enquanto aberto", async () => {
    vi.useFakeTimers();
    const m = await montar();
    await m.amostra({ cpu: 40, ram: 61 });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /CPU 40/ })); });
    const abertas = () => m.detalhe.mock.calls.filter((c) => c[0] === true).length;
    const n0 = abertas();
    await act(async () => { await vi.advanceTimersByTimeAsync(4_100); });
    expect(abertas()).toBeGreaterThanOrEqual(n0 + 2);
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "Escape" }); });
    const n1 = abertas();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(abertas()).toBe(n1);
  });

  it("'Ocultar este medidor' grava a preferência, desassina o main e some o chip", async () => {
    const m = await montar();
    await m.amostra({ cpu: 40, ram: 61 });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /CPU 40/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ocultar este medidor" })); });
    expect(m.config.gravar).toHaveBeenCalledWith("medidor_sistema_mostrar", false);
    expect(m.api.assinar).toHaveBeenLastCalledWith(false);
    expect(document.querySelector(".sis-chip")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("abrir o popover de limites fecha este (um só aberto)", async () => {
    const m = await montar();
    await m.amostra({ cpu: 40, ram: 61 });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /CPU 40/ })); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => { abrirPopoverLimites(); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("CSS do medidor", () => {
  const css = readFileSync(resolve(__dirname, "sistema.css"), "utf8");
  it("só tokens: nenhuma cor literal (hex, rgb, hsl) e nada de rosa", () => {
    const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(semComentarios).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(semComentarios).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|lab)\(/);
    expect(semComentarios).not.toMatch(/\b(pink|magenta|fuchsia|hotpink)\b/i);
  });
  it("breakpoints do cabeçalho: números curtos < 1360 px e ícone único < 960 px; fonte do chip ≥ 11,5 px; alvo ≥ 28 px", () => {
    expect(css).toMatch(/@container \(max-width: 1360px\)[\s\S]*\.sis-rot \{ display: none; \}/);
    expect(css).toMatch(/@container \(max-width: 960px\)[\s\S]*\.sis-item, \.sis-sep \{ display: none; \}/);
    expect(css).toMatch(/\.sis-chip \{[^}]*min-height: 28px[^}]*font: 11\.5px/);
    expect(css).toMatch(/\.sis-barra \{[^}]*height: 3px/);
  });
  it("sem animação nem transição própria (prefers-reduced-motion não precisa de exceção)", () => {
    expect(css).not.toMatch(/animation|transition|@keyframes/);
  });
});
