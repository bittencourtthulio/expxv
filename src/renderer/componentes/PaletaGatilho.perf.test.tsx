// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pedirPaleta } from "../estado/navegacao";
import { PaletaGatilho, precarregarPaleta } from "./PaletaGatilho";

// Correção de desempenho comprovada no Electron real (tests/perf/casca.perf.ts, P-02b): a 1ª abertura da paleta levava ~310 ms
// com o runtime ocioso, ainda que o chunk já estivesse carregado. Causa (perfil: 354 ms "idle", 0 ms de JS, nenhuma rede): o
// `React.lazy` suspende na 1ª renderização mesmo com o módulo resolvido, aparece o fallback e o React segura a revelação do
// conteúdo por ~300 ms (throttle de Suspense). Com o chunk pré-carregado a paleta tem de aparecer NA MESMA renderização, sem
// suspender: nenhum `await` entre o pedido e o diálogo.
describe("PaletaGatilho com o chunk pré-carregado", () => {
  it("abre na mesma renderização do pedido (sem suspender, sem fallback)", async () => {
    await precarregarPaleta();
    render(<PaletaGatilho />);
    act(() => { pedirPaleta(); }); // act SÍNCRONO: nenhuma microtask/Suspense pode resolver entre o pedido e o diálogo
    expect(screen.queryByRole("dialog", { name: "Paleta de comandos" })).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
  });
});
