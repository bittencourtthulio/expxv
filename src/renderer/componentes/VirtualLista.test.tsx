// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { VirtualLista } from "./VirtualLista";

const itens = Array.from({ length: 5000 }, (_, i) => ({ id: `L${i}`, texto: `linha ${i}` }));
const montar = (lista = itens) =>
  render(<VirtualLista itens={lista} alturaItem={20} alturaPadrao={200} rotulo="Linhas" chave={(x) => x.id} renderItem={(x) => <span>{x.texto}</span>} />);

describe("VirtualLista", () => {
  it("mantém só as linhas visíveis no DOM e anuncia o total", () => {
    montar();
    const n = document.querySelectorAll(".virtual-linha").length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(40);
    expect(screen.getByText("linha 0")).toBeTruthy();
    expect(screen.queryByText("linha 4000")).toBeNull();
    expect(screen.getByRole("list", { name: "Linhas" }).getAttribute("data-total")).toBe("5000");
  });

  it("ao rolar troca a janela renderizada", async () => {
    montar();
    const lista = screen.getByRole("list", { name: "Linhas" });
    await act(async () => {
      lista.scrollTop = 20 * 3000;
      fireEvent.scroll(lista);
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(screen.getByText("linha 3005")).toBeTruthy();
    expect(screen.queryByText("linha 0")).toBeNull();
    expect(document.querySelectorAll(".virtual-linha").length).toBeLessThan(40);
  });

  it("lista vazia não renderiza linhas", () => {
    montar([]);
    expect(document.querySelectorAll(".virtual-linha").length).toBe(0);
  });
});
