// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreferenciasVcs } from "./PreferenciasVcs";

describe("Preferências do versionamento (opt-in)", () => {
  it("tudo desligado por padrão; ligar o fetch em segundo plano grava só `true` na chave certa", async () => {
    const config = { ler: vi.fn(async () => undefined), gravar: vi.fn(async () => ({ ok: true as const })) };
    render(<PreferenciasVcs config={config as never} />);
    expect(config.ler).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preferências do versionamento" }));
    const caixa = (await screen.findByRole("checkbox", { name: /segundo plano/ })) as HTMLInputElement;
    await waitFor(() => expect(config.ler).toHaveBeenCalledWith("vcs_fetch_segundo_plano"));
    expect(caixa.checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: /PRs e checks/ }) as HTMLInputElement).checked).toBe(false);
    await act(async () => { fireEvent.click(caixa); });
    expect(config.gravar).toHaveBeenCalledWith("vcs_fetch_segundo_plano", true);
    expect(caixa.checked).toBe(true);
    expect(screen.getByText(/nunca envia/)).toBeTruthy();
  });
  it("valor gravado como texto não liga; falha ao gravar mostra o erro e não muda a caixa", async () => {
    const config = { ler: vi.fn(async () => "true"), gravar: vi.fn(async () => { throw new Error("disco cheio"); }) };
    render(<PreferenciasVcs config={config as never} />);
    fireEvent.click(screen.getByRole("button", { name: "Preferências do versionamento" }));
    const caixa = (await screen.findByRole("checkbox", { name: /PRs e checks/ })) as HTMLInputElement;
    expect(caixa.checked).toBe(false);
    await act(async () => { fireEvent.click(caixa); });
    expect((await screen.findByRole("alert")).textContent).toContain("disco cheio");
    expect(caixa.checked).toBe(false);
  });
  it("sem API de configuração não renderiza nada", () => {
    const { container } = render(<PreferenciasVcs config={undefined} />);
    expect(container.textContent).toBe("");
  });
});
