// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemLista } from "./ItemLista";

afterEach(cleanup);

describe("ItemLista (padrão único de listas)", () => {
  it("renderiza título, descrição, selos com tom, meta e ação; corpo abre ao clicar", () => {
    const aoAbrir = vi.fn();
    render(
      <ItemLista
        titulo="Context7"
        descricao="Documentação viva para as CLIs"
        selos={[
          { texto: "oficial", tom: "destaque" },
          { texto: "gratuito", tom: "sucesso", titulo: "Sem custo" },
        ]}
        meta={<span>3 ferramentas</span>}
        acao={<button type="button">Instalar</button>}
        aoAbrir={aoAbrir}
      />,
    );
    const corpo = screen.getByRole("button", { name: "Context7: detalhes" });
    fireEvent.click(corpo);
    expect(aoAbrir).toHaveBeenCalledTimes(1);
    const selos = screen.getAllByText(/oficial|gratuito/);
    expect(selos[0]?.getAttribute("data-tom")).toBe("destaque");
    expect(selos[1]?.getAttribute("title")).toBe("Sem custo");
    expect(screen.getByText("3 ferramentas")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Instalar" })).toBeTruthy();
    expect(corpo.getAttribute("aria-pressed")).toBeNull();
  });

  it("marca selecionado (aria-pressed + data-selecionado) e aceita linha densa", () => {
    render(<ItemLista titulo="Alfa" descricao="curta" selecionado densa aoAbrir={() => {}} />);
    const corpo = screen.getByRole("button", { name: "Alfa: detalhes" });
    expect(corpo.getAttribute("aria-pressed")).toBe("true");
    expect(corpo.closest(".lst-linha")?.getAttribute("data-selecionado")).toBe("true");
    expect(corpo.closest(".lst-linha")?.getAttribute("data-densa")).toBe("true");
  });

  it("sem descrição/selos/meta/ação renderiza o mínimo sem quebrar", () => {
    render(<ItemLista titulo="Só título" aoAbrir={() => {}} />);
    expect(screen.getByRole("button", { name: "Só título: detalhes" })).toBeTruthy();
    expect(document.querySelector(".lst-selo")).toBeNull();
    expect(document.querySelector(".lst-meta")).toBeNull();
    expect(document.querySelector(".lst-acao")).toBeNull();
  });

  it("nome truncável leva title com o texto integral", () => {
    render(<ItemLista titulo="Servidor de MCP com nome comprido" aoAbrir={() => {}} />);
    const nome = document.querySelector(".lst-nome");
    expect(nome?.getAttribute("title")).toBe("Servidor de MCP com nome comprido");
  });

  it("sem aoAbrir o corpo é div (linha de leitura, sem botão fantasma) e rotuloCorpo sobrepõe o padrão", () => {
    const { rerender } = render(<ItemLista titulo="Somente leitura" descricao="sem clique" />);
    expect(document.querySelector(".lst-corpo")?.tagName).toBe("DIV");
    expect(screen.queryByRole("button", { name: /detalhes/ })).toBeNull();
    rerender(<ItemLista titulo="Trocar de branch" rotuloCorpo="Trocar para main" aoAbrir={() => {}} />);
    expect(screen.getByRole("button", { name: "Trocar para main" })).toBeTruthy();
  });
});
