// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { harnessFalso, limitesFalso, RESPOSTA_LIMITES, trocas } from "../../a11y/ade-falso-harness";
import { criarStoreLimites } from "../../estado/limites";
import { caminhoSerie } from "./graficos/Sparkline";
import { TelaConsumo } from "./index";

afterEach(cleanup);

async function montar(opcoes: { limites?: Record<string, unknown>; harness?: Record<string, unknown>; semAlertas?: boolean } = {}) {
  const limites = { ...limitesFalso(), ...opcoes.limites };
  const harness = { ...harnessFalso(), ...opcoes.harness };
  const store = criarStoreLimites({ api: () => limites as never });
  await act(async () => { render(<TelaConsumo store={store} apiLimites={limites as never} apiHarness={harness as never} />); });
  return { limites, harness, store };
}

describe("Tela Consumo", () => {
  it("visão geral: uma linha por conta, % atual, sem dado, alerta e sparkline com histórico", async () => {
    await montar();
    const lista = await screen.findByRole("list", { name: "Consumo por conta" });
    const linhas = within(lista).getAllByRole("listitem").filter((l) => l.className.includes("consumo-linha") && !l.className.includes("cab"));
    expect(linhas).toHaveLength(3);
    expect(within(lista).getAllByLabelText(/Uso atual 62%/)).toHaveLength(1);
    expect(within(lista).getByText("consumo alto")).toBeTruthy();
    expect(within(lista).getAllByText(/sem dado/).length).toBeGreaterThan(0);
    expect(within(lista).getAllByRole("img", { name: /5 horas de c1: último 62%/ })).toHaveLength(1);
    // conta sem janelas: nunca 0%
    expect(linhas[2]!.textContent).not.toMatch(/\b0%/);
  });
  it("histórico indisponível não quebra a tela", async () => {
    const { historico: _h, ...resto } = limitesFalso();
    await montar({ limites: { historico: undefined, ...resto } });
    expect((await screen.findAllByText("indisp.")).length).toBeGreaterThan(0);
  });
  it("agrupar por Missão mostra 'disponível depois da ingestão de uso (fase 10)'", async () => {
    await montar();
    await screen.findByRole("list", { name: "Consumo por conta" });
    fireEvent.change(screen.getByLabelText("Agrupar por"), { target: { value: "missao" } });
    expect(screen.getByText(/Disponível depois da ingestão de uso \(fase 10\)/)).toBeTruthy();
  });
  it("agrupar por modelo lista baldes, com esgotado marcado", async () => {
    await montar();
    await screen.findByRole("list", { name: "Consumo por conta" });
    fireEvent.change(screen.getByLabelText("Agrupar por"), { target: { value: "modelo" } });
    const lista = screen.getByRole("list", { name: "Consumo por modelo" });
    expect(lista.textContent).toContain("esgotado");
    // mesmo componente do popover: provedor com logo e nome, modelo com rótulo legível e barra
    expect(lista.querySelector(".uso-provedor[data-provedor='claude'] svg.logo-provedor")).not.toBeNull();
    expect(within(lista).getAllByRole("meter", { name: /modelo Opus, 100 por cento/ }).length).toBeGreaterThan(0);
  });
  it("agrupar por provedor traz logo e nome do provedor no cabeçalho do grupo", async () => {
    await montar();
    await screen.findByRole("list", { name: "Consumo por conta" });
    fireEvent.change(screen.getByLabelText("Agrupar por"), { target: { value: "provedor" } });
    const lista = screen.getByRole("list", { name: "Consumo por provedor" });
    const grupos = [...lista.querySelectorAll(".consumo-grupo")].map((g) => g.textContent?.trim());
    expect(grupos).toEqual(["Claude", "Codex"]);
    expect(lista.querySelectorAll(".consumo-grupo svg.logo-provedor")).toHaveLength(2);
  });
  it("filtro sem resultado explica o próximo passo", async () => {
    await montar();
    await screen.findByRole("list", { name: "Consumo por conta" });
    fireEvent.change(screen.getByLabelText("Filtrar contas"), { target: { value: "zzz" } });
    expect(screen.getByText("Nada corresponde ao filtro")).toBeTruthy();
  });
  it("previsão, eficiência e alertas; insuficiente nunca vira chute", async () => {
    const { limites } = await montar({ limites: { previsao: vi.fn().mockResolvedValue([{ janela: "five_hour", atual_pct: 5, ritmo_pct_por_hora: null, zera_em: null, antes_do_reset: false, confianca: "insuficiente" }]) } });
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Previsão e eficiência" })); });
    expect((await screen.findAllByText(/dados insuficientes/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Nenhum alerta|87% da janela/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "Pico semanal de uso" })).toBeTruthy();
    expect(screen.getAllByText("cedo").length).toBeGreaterThan(0);
    expect(limites.previsao).toHaveBeenCalled();
  });
  it("previsão com zera_em mostra hora e 'antes de resetar'", async () => {
    await montar();
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Previsão e eficiência" })); });
    expect((await screen.findAllByText(/zera às .*antes de resetar/)).length).toBeGreaterThan(0);
  });
  it("canais ausentes: previsão e eficiência mostram 'indisponível'", async () => {
    await montar({ limites: { previsao: undefined, eficiencia: undefined, alertas: undefined, historico: undefined } });
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Previsão e eficiência" })); });
    expect((await screen.findAllByText(/Previsão indisponível/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Eficiência indisponível/)).toBeTruthy();
    expect(screen.getByText(/Alertas indisponíveis/)).toBeTruthy();
  });
  it("Trocas: log com status e aceitar sugestão chama harness:troca_decidir", async () => {
    const decidirTroca = vi.fn().mockResolvedValue(trocas[0]);
    await montar({ harness: { decidirTroca } });
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Trocas" })); });
    const log = await screen.findByRole("list", { name: "Log de trocas" });
    expect(log.textContent).toContain("sugerida");
    expect(log.textContent).toContain("limite atingido");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Aceitar troca t1" })); });
    expect(decidirTroca).toHaveBeenCalledWith("t1", "aceitar");
  });
  it("sem API de trocas: estado indisponível", async () => {
    await montar({ harness: { listarTrocas: undefined } });
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Trocas" })); });
    expect(screen.getByText("Log de trocas indisponível")).toBeTruthy();
  });
  it("sem conta: estado vazio com próximo passo; sem canal: indisponível", async () => {
    await montar({ limites: { snapshot: async () => ({ ...RESPOSTA_LIMITES, contas: [] }), atualizar: async () => ({ ...RESPOSTA_LIMITES, contas: [] }) } });
    expect(await screen.findByText("Nenhuma conta com limites")).toBeTruthy();
    cleanup();
    const store = criarStoreLimites({ api: () => undefined });
    await act(async () => { render(<TelaConsumo store={store} apiLimites={undefined} apiHarness={undefined} />); });
    expect(await screen.findByText("Limites indisponíveis")).toBeTruthy();
  });
  it("aba Detalhe por uso (fase 10): sem o serviço de custo na janela explica o próximo passo", async () => {
    await montar();
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Detalhe por uso" })); });
    expect(screen.getByText("Custo indisponível")).toBeTruthy();
  });
});

describe("gráficos", () => {
  it("caminhoSerie normaliza, decima a 300 pontos e fica vazio sem dado", () => {
    expect(caminhoSerie([], 80, 18)).toBe("");
    const d = caminhoSerie(Array.from({ length: 5000 }, (_, i) => ({ x: i, y: i % 100 })), 100, 20);
    expect((d.match(/[ML]/g) ?? []).length).toBe(300);
    expect(caminhoSerie([{ x: 0, y: 0 }, { x: 10, y: 100 }], 100, 20)).toBe("M0.0 20.0L100.0 0.0");
  });
});
