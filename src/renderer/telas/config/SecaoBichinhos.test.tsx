// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { criarStoreBichinho } from "../../bichinho/estado";
import { SecaoBichinhos } from "./SecaoBichinhos";

afterEach(cleanup);

describe("SecaoBichinhos (preferências globais)", () => {
  it("liga/desliga 'Mostrar bichinhos' e 'Silenciar animações' pelo store e grava nas chaves do contrato", async () => {
    const gravar = vi.fn(async () => ({ ok: true as const }));
    const store = criarStoreBichinho({ api: () => undefined, config: () => ({ ler: async () => undefined, gravar }) as never });
    render(<SecaoBichinhos carregar={async () => store} />);
    const mostrar = await screen.findByRole("switch", { name: /Mostrar bichinhos: ligado/ });
    await act(async () => { await Promise.resolve(); });
    expect((mostrar as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(mostrar);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("switch", { name: /Mostrar bichinhos: desligado/ }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("switch", { name: "Silenciar animações" }));
    await act(async () => { await Promise.resolve(); });
    expect(gravar).toHaveBeenCalledWith("bichinho_mostrar", false);
    expect(gravar).toHaveBeenCalledWith("bichinho_silenciar", true);
    expect(screen.getByRole("switch", { name: "Animações silenciadas" })).toBeTruthy();
  });
});
