// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { CODIGO_SECRETO, avancarSequencia, ligarSegredo } from "./segredo";

const tecla = (k: string, alvo: EventTarget = window, extra: KeyboardEventInit = {}) => { const e = new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }); alvo.dispatchEvent(e); };

describe("atalho escondido (Konami)", () => {
  it("a sequência certa dispara uma vez; a errada não", () => {
    const f = vi.fn();
    const soltar = ligarSegredo(window, f);
    for (const k of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "B", "a"]) tecla(k);
    expect(f).toHaveBeenCalledTimes(1);
    for (const k of ["ArrowUp", "ArrowUp", "ArrowDown", "x", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) tecla(k);
    expect(f).toHaveBeenCalledTimes(1);
    soltar();
    for (const k of CODIGO_SECRETO) tecla(k);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("não vale em campo de texto, nem com modificador", () => {
    const f = vi.fn();
    const soltar = ligarSegredo(window, f);
    const campo = document.createElement("input"); document.body.append(campo);
    for (const k of CODIGO_SECRETO) tecla(k, campo);
    const term = document.createElement("div"); term.className = "xterm"; document.body.append(term);
    for (const k of CODIGO_SECRETO) tecla(k, term);
    for (const k of CODIGO_SECRETO) tecla(k, window, { metaKey: true });
    expect(f).not.toHaveBeenCalled();
    soltar(); campo.remove(); term.remove();
  });
  it("avancarSequencia: erro volta ao início, mas a tecla errada pode ser a primeira", () => {
    expect(avancarSequencia(0, "ArrowUp")).toBe(1);
    expect(avancarSequencia(3, "ArrowUp")).toBe(1);
    expect(avancarSequencia(3, "q")).toBe(0);
    expect(avancarSequencia(8, "B")).toBe(9);
  });
});
