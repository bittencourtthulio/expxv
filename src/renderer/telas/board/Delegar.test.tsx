// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardFalso } from "./fabrica-teste";
import { DelegarCard } from "./Delegar";

afterEach(() => { cleanup(); delete (globalThis as { ade?: unknown }).ade; });
const semHistorico = { mediana_usd: null, p25_usd: null, p75_usd: null, amostras: 1, confianca: "sem_historico" as const };
const comHistorico = { mediana_usd: 1.5, p25_usd: 1, p75_usd: 2, amostras: 5, confianca: "media" as const };
function montar(delegarCard: (p: unknown) => Promise<unknown>) {
  (globalThis as unknown as { ade: unknown }).ade = { custo: { estimativa: async () => semHistorico }, board: { delegarCard }, harness: {} };
  const card = cardFalso(4);
  return render(<DelegarCard card={card} aoFechar={() => undefined} aoDelegado={() => undefined} />);
}

describe("DelegarCard: estimativa no recibo e bloqueio por teto (P-80)", () => {
  it("a estimativa do recibo substitui a do diálogo e nunca é apresentada como custo do card", async () => {
    montar(vi.fn(async () => ({ pane_id: "p1", task_ref: "T-04", recibo: "rota X", estimativa: comHistorico })));
    await screen.findByText(/sem histórico \(1 amostra/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar" })); });
    const nota = await screen.findByText(/Estimativa de custo: mediana/);
    expect(nota.textContent).toMatch(/não é o custo do card/);
  });
  it("ceiling_reached vira mensagem clara e nada em andamento é citado como interrompido", async () => {
    montar(vi.fn(async () => { throw new Error("rule_violation.ceiling_reached: o teto de custo da Missão foi atingido"); }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar" })); });
    expect((await screen.findByRole("alert")).textContent).toMatch(/teto de custo da Missão foi atingido.*Nada em andamento foi interrompido/);
  });
});
