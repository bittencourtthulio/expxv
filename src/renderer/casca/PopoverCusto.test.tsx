// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RESPOSTA_LIMITES } from "../a11y/ade-falso-harness";
import { storeLimites } from "../estado/limites";
import { abrirPopoverLimites, fecharPopoverLimites } from "../estado/popover-limites";
import { resumoCusto } from "../telas/board/fabrica-teste";
import { PopoverLimites } from "./PopoverLimites";

afterEach(() => { cleanup(); fecharPopoverLimites(); delete (globalThis as { ade?: unknown }).ade; });

async function abrir(relatorio: ((p: { agrupar: string; desde: string }) => Promise<unknown>) | undefined) {
  const limites = { snapshot: vi.fn().mockResolvedValue(RESPOSTA_LIMITES), atualizar: vi.fn().mockResolvedValue(RESPOSTA_LIMITES), previsao: vi.fn().mockResolvedValue([]), assinar: vi.fn().mockReturnValue(() => undefined) };
  (globalThis as unknown as { ade: unknown }).ade = { limites, ...(relatorio === undefined ? {} : { custo: { relatorio } }) };
  await act(async () => { await storeLimites.iniciar(); await storeLimites.atualizar(); });
  await act(async () => { render(<PopoverLimites />); });
  await act(async () => { abrirPopoverLimites(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("popover de limites: custo por conta (T-10.26)", () => {
  it("mostra 'hoje · 7 d' do agregado por conta, com ≥ e sem 0 fantasma; conta sem dado mostra —", async () => {
    await abrir(async (p) => ({ linhas: [{ chave: "c1", rotulo: "c1", custo: resumoCusto(p.agrupar === "conta" && Date.now() - Date.parse(p.desde) < 90_000_000 ? 0.5 : 3, { incompleto: true }) }], total: resumoCusto(1), proximo: null }));
    const dlg = screen.getByRole("dialog", { name: "Cotas e limites" });
    const linhas = within(dlg).getAllByTitle("Custo equivalente em API, pelo uso observado");
    expect(linhas[0]!.textContent).toBe("≥ US$ 0,50 · ≥ US$ 3,00");
    expect(linhas.slice(1).every((l) => l.textContent === "— · —")).toBe(true);
    expect(within(dlg).getByRole("button", { name: "Detalhe por uso" })).toBeTruthy();
  });
  it("sem a API de custo o popover continua e mostra —", async () => {
    await abrir(undefined);
    expect(screen.getAllByTitle("Custo equivalente em API, pelo uso observado")[0]!.textContent).toBe("— · —");
  });
});
