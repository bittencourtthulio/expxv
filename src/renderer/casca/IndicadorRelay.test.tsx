// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { aoPedirJarvis } from "../estado/jarvis-acoes";
import { apiRelayFalsa, estadoRelayFalso } from "../telas/jarvis/fabrica-teste";
import { IndicadorRelay } from "./IndicadorRelay";

afterEach(cleanup);
describe("rodapé: indicador do relay", () => {
  it("some com o relay desligado; mostra `● relay · N` ligado e abre a aba Relay no clique", async () => {
    const api = apiRelayFalsa();
    await act(async () => { render(<IndicadorRelay api={api} />); });
    expect(screen.queryByRole("button")).toBeNull();
    api.definir({ estado: estadoRelayFalso({ ligado: true, situacao: "conectado", dispositivos: 2 }) });
    await act(async () => { api.emitir(); });
    const b = screen.getByRole("button", { name: /relay · 2/ });
    expect(b.textContent).toContain("●");
    const abas: string[] = [];
    const parar = aoPedirJarvis((p) => abas.push(p.aba));
    await act(async () => { fireEvent.click(b); });
    parar();
    expect(abas).toEqual(["relay"]);
  });
  it("sem API (fora do app) não renderiza nada", async () => {
    await act(async () => { render(<IndicadorRelay api={undefined} />); });
    expect(document.body.textContent).toBe("");
  });
});
