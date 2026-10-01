// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { Divisor, limitarRazao } from "./Divisor";

describe("limitarRazao", () => {
  it("fica entre 10% e 90% e troca NaN por 50%", () => {
    expect(limitarRazao(0)).toBe(0.1);
    expect(limitarRazao(2)).toBe(0.9);
    expect(limitarRazao(Number.NaN)).toBe(0.5);
    expect(limitarRazao(0.3)).toBe(0.3);
  });
});

describe("Divisor", () => {
  it("expõe role=separator com orientação e valor, e as setas movem em passos de 5%", () => {
    const mudar = vi.fn();
    render(<Divisor orientacao="vertical" razao={0.5} caixa={createRef()} aoMudar={mudar} />);
    const sep = screen.getByRole("separator");
    expect(sep.getAttribute("aria-orientation")).toBe("vertical");
    expect(sep.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(mudar.mock.calls.map((c) => Math.round((c[0] as number) * 100))).toEqual([55, 45]);
  });
  it("horizontal usa setas para cima/baixo; teclas alheias não são consumidas", () => {
    const mudar = vi.fn();
    render(<Divisor orientacao="horizontal" razao={0.5} caixa={createRef()} aoMudar={mudar} />);
    const sep = screen.getByRole("separator");
    fireEvent.keyDown(sep, { key: "ArrowDown" });
    fireEvent.keyDown(sep, { key: "a" });
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(mudar).toHaveBeenCalledTimes(1);
    expect(sep.getAttribute("aria-orientation")).toBe("horizontal");
  });
});
