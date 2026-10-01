// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sinaleira } from "./Sinaleira";

describe("Sinaleira", () => {
  it("mostra cor, glifo e motivo em texto (cor nunca é o único sinal)", () => {
    render(<Sinaleira sinaleira={{ cor: "vermelho", motivo: "Bloqueio aberto há 9 dias", motivos: [] }} />);
    const g = screen.getByRole("group");
    expect(g.getAttribute("aria-label")).toBe("Sinaleira parado: Bloqueio aberto há 9 dias");
    expect(g.textContent).toContain("Bloqueio aberto há 9 dias");
    expect(g.textContent).toContain("✕");
    expect(g.getAttribute("data-cor")).toBe("vermelho");
  });

  it("cinza também tem glifo e texto", () => {
    render(<Sinaleira compacta sinaleira={{ cor: "cinza", motivo: "Sem atividade", motivos: [] }} />);
    expect(screen.getByRole("group").textContent).toContain("–");
    expect(screen.getByLabelText(/Sem atividade/)).toBeTruthy();
  });
});
