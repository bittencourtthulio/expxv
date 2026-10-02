// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeletorRegiao } from "./SeletorRegiao";

afterEach(cleanup);

function montar(extra: Partial<Parameters<typeof SeletorRegiao>[0]> = {}) {
  const aoConfirmar = vi.fn();
  const aoCancelar = vi.fn();
  render(<SeletorRegiao src="data:image/jpeg;base64,AA==" largura={1440} altura={900} area={{ w: 720, h: 450 }} aoConfirmar={aoConfirmar} aoCancelar={aoCancelar} {...extra} />);
  return { aoConfirmar, aoCancelar, caixa: screen.getByRole("dialog") };
}
const ponto = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });

describe("SeletorRegiao", () => {
  it("arrastar devolve a seleção em coordenadas LÓGICAS do display (escala 0.5 -> dobra)", () => {
    const { aoConfirmar, caixa } = montar();
    fireEvent.pointerDown(caixa, ponto(50, 50));
    fireEvent.pointerMove(caixa, ponto(150, 100));
    fireEvent.pointerUp(caixa, ponto(150, 100));
    expect(aoConfirmar).toHaveBeenCalledWith({ x: 100, y: 100, largura: 200, altura: 100 });
  });

  it("arrastar para cima e para a esquerda também funciona", () => {
    const { aoConfirmar, caixa } = montar();
    fireEvent.pointerDown(caixa, ponto(150, 100));
    fireEvent.pointerUp(caixa, ponto(50, 50));
    expect(aoConfirmar).toHaveBeenCalledWith({ x: 100, y: 100, largura: 200, altura: 100 });
  });

  it("menor que 5x5 px lógicos cancela em vez de confirmar", () => {
    const { aoConfirmar, aoCancelar, caixa } = montar();
    fireEvent.pointerDown(caixa, ponto(50, 50));
    fireEvent.pointerUp(caixa, ponto(52, 52));
    expect(aoConfirmar).not.toHaveBeenCalled();
    expect(aoCancelar).toHaveBeenCalledTimes(1);
  });

  it("Esc cancela de qualquer ponto e não confirma", () => {
    const { aoConfirmar, aoCancelar } = montar();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(aoCancelar).toHaveBeenCalledTimes(1);
    expect(aoConfirmar).not.toHaveBeenCalled();
  });

  it("mostra mira e leitor x,y · WxH durante o arrasto; rótulo acessível explica", () => {
    const { caixa } = montar();
    expect(caixa.getAttribute("aria-label")).toMatch(/Esc cancela/);
    fireEvent.pointerDown(caixa, ponto(50, 50));
    fireEvent.pointerMove(caixa, ponto(150, 100));
    expect(caixa.textContent).toContain("300,200 · 200x100");
    expect(caixa.querySelector(".cap-mira-h")).not.toBeNull();
    expect(caixa.querySelector(".cap-selecao")).not.toBeNull();
  });

  it("botão direito e cancelamento do ponteiro não confirmam", () => {
    const { aoConfirmar, aoCancelar, caixa } = montar();
    fireEvent.pointerDown(caixa, { ...ponto(10, 10), button: 2 });
    fireEvent.pointerUp(caixa, ponto(200, 200));
    expect(aoConfirmar).not.toHaveBeenCalled();
    fireEvent.pointerDown(caixa, ponto(10, 10));
    fireEvent.pointerCancel(caixa);
    expect(aoCancelar).toHaveBeenCalledTimes(1);
  });
});
