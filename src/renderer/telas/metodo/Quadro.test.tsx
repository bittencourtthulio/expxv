// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Quadro } from "./Quadro";
import { tk, trabalho } from "./fabrica";

describe("Quadro", () => {
  it("separa por status, marca pronta e mostra depende_de e bloqueio", () => {
    const t = trabalho(
      [
        tk("T-1", { status: "concluida" }),
        tk("T-2", { depende_de: ["T-1"] }),
        tk("T-3", { depende_de: ["T-2"] }),
        tk("T-4", { status: "em_andamento", duracao_observada_ms: 125000 }),
        tk("T-5", { status: "bloqueada" }),
      ],
      { bloqueios: [{ id: "B-1", task: "T-5", aberto_em: null, resolvido_em: null, aberto: true, descricao: "falta credencial", arquivo: "x" }] },
    );
    render(<Quadro trabalho={t} />);
    const col = (n: string) => within(screen.getByRole("region", { name: `Coluna ${n}` }));
    expect(col("Pendente").getByText("T-2")).toBeTruthy();
    expect(col("Pendente").getByText("T-3")).toBeTruthy();
    expect(col("Concluída").getByText("T-1")).toBeTruthy();
    expect(col("Em andamento").getByText("T-4")).toBeTruthy();
    expect(col("Em andamento").getByText(/duração observada: 2 min 5 s/)).toBeTruthy();
    expect(col("Bloqueada").getByText(/Bloqueio: falta credencial/)).toBeTruthy();
    expect(screen.getByLabelText("T-2, Pendente, pronta")).toBeTruthy();
    expect(screen.getByLabelText("T-3, Pendente")).toBeTruthy();
    expect(screen.getByText(/depende de T-2/)).toBeTruthy();
  });

  it("1 000 cards: só os visíveis existem no DOM", () => {
    const tasks = Array.from({ length: 1000 }, (_, i) => tk(`T-${i}`, { status: "pendente" }));
    render(<Quadro trabalho={trabalho(tasks)} />);
    const cards = document.querySelectorAll(".met-card").length;
    expect(cards).toBeGreaterThan(0);
    expect(cards).toBeLessThan(40);
    expect(screen.getByRole("region", { name: "Coluna Pendente" }).textContent).toContain("1000");
    expect(screen.queryByText("T-900")).toBeNull();
  });
});
