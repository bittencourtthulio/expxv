import { describe, expect, it } from "vitest";
import { TEMA_XTERM_CLARO, TEMA_XTERM_ESCURO, temaXterm } from "./tema-xterm";

const luz = (hex: string) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000; };

describe("tema-xterm", () => {
  it("escolhe o tema pelo tema efetivo do app", () => {
    expect(temaXterm("escuro")).toBe(TEMA_XTERM_ESCURO);
    expect(temaXterm("claro")).toBe(TEMA_XTERM_CLARO);
  });
  it("fundo escuro é mais escuro que o texto e o claro é o inverso; mesmas chaves nos dois", () => {
    expect(luz(TEMA_XTERM_ESCURO.background!)).toBeLessThan(luz(TEMA_XTERM_ESCURO.foreground!));
    expect(luz(TEMA_XTERM_CLARO.background!)).toBeGreaterThan(luz(TEMA_XTERM_CLARO.foreground!));
    expect(Object.keys(TEMA_XTERM_CLARO).sort()).toEqual(Object.keys(TEMA_XTERM_ESCURO).sort());
  });
});
