// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Virtualizada } from "./Virtualizada";

const itens = Array.from({ length: 1000 }, (_, i) => ({ id: `i${i}` }));
const montar = () => render(<Virtualizada itens={itens} alturaItem={40} alturaPadrao={400} margem={3} rotulo="Teste" chave={(x) => x.id} renderizar={(x) => <span>{x.id}</span>} />);

describe("Virtualizada", () => {
  it("com 1 000 itens só a janela mais a margem existe no DOM", () => {
    montar();
    const n = screen.getAllByRole("listitem").length;
    expect(n).toBeLessThanOrEqual(10 + 3 * 2);
    expect(screen.getByText("i0")).toBeTruthy();
    expect(screen.queryByText("i500")).toBeNull();
  });
  it("ao rolar troca os nós e mantém a contagem pequena", () => {
    montar();
    const lista = screen.getByRole("list", { name: "Teste" });
    lista.scrollTop = 40 * 500;
    fireEvent.scroll(lista);
    expect(screen.getByText("i500")).toBeTruthy();
    expect(screen.queryByText("i0")).toBeNull();
    expect(screen.getAllByRole("listitem").length).toBeLessThanOrEqual(16);
  });
});
