// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Grafo from "./Grafo";
import { tk, trabalho } from "./fabrica";

describe("Grafo", () => {
  it("com ciclo abre expandido e destaca nós e arestas do ciclo", () => {
    const t = trabalho([tk("A", { depende_de: ["B"] }), tk("B", { depende_de: ["A"] }), tk("C", { depende_de: ["A"] })], {}, { ciclos: [["A", "B"]] });
    const { container } = render(<Grafo trabalho={t} />);
    expect(screen.getByRole("button", { name: /Por task/ }).getAttribute("aria-pressed")).toBe("true");
    const ciclo = [...container.querySelectorAll('g[data-ciclo="true"]')].map((g) => g.getAttribute("data-no"));
    expect(ciclo.sort()).toEqual(["A", "B"]);
    expect(container.querySelectorAll('line[data-ciclo="true"]').length).toBeGreaterThan(0);
    expect(screen.getByText(/Ciclo de dependências: A → B → A/)).toBeTruthy();
  });

  it("destaca caminho crítico e dependência inexistente", () => {
    const t = trabalho([tk("A"), tk("B", { depende_de: ["A"] }), tk("C", { depende_de: ["B", "Z"] })], {}, { caminho_critico: ["A", "B", "C"] });
    const { container } = render(<Grafo trabalho={t} />);
    // sem ciclo abre por fase; expande para ver as tasks
    expect(screen.getByRole("button", { name: /Por fase/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Por task/ }));
    const crit = [...container.querySelectorAll('g[data-critico="true"]')].map((g) => g.getAttribute("data-no"));
    expect(crit.sort()).toEqual(["A", "B", "C"]);
    expect(container.querySelectorAll('line[data-critico="true"]').length).toBe(2);
    expect(container.querySelector('g[data-ausente="true"]')?.getAttribute("data-no")).toBe("Z");
    expect(screen.getByText(/Dependência inexistente: C depende de Z/)).toBeTruthy();
    expect(screen.getByText(/Caminho crítico: A → B → C/)).toBeTruthy();
  });

  it("plano vazio mostra mensagem", () => {
    render(<Grafo trabalho={trabalho([])} />);
    expect(screen.getByText(/ainda não tem plano/)).toBeTruthy();
  });
});
