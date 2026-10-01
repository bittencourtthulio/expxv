// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pedirPaleta } from "../estado/navegacao";
import { PaletaGatilho } from "./PaletaGatilho";

describe("PaletaGatilho", () => {
  it("o pedido do menu nativo (pedirPaleta) abre a paleta", async () => {
    render(<PaletaGatilho />);
    expect(screen.queryByRole("dialog", { name: "Paleta de comandos" })).toBeNull();
    await act(async () => { pedirPaleta(); });
    // teto de ESPERA (não de latência): a 1ª importação do chunk sob carga pesada passou de 1 s (padrão do findBy) e deu falso vermelho
    expect(await screen.findByRole("dialog", { name: "Paleta de comandos" }, { timeout: 15_000 })).toBeTruthy();
  });
});
