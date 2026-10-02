// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SubNavegacao, idAba, idPainel } from "./SubNavegacao";
import type { ItemSubNav } from "./subnavegacao-logica";

afterEach(() => { cleanup(); try { window.localStorage.clear(); } catch { /* sem storage */ } });

const ITENS: ItemSubNav<"a" | "b" | "c">[] = [
  { id: "a", rotulo: "Alfa", icone: "agil", grupo: "Um" }, { id: "b", rotulo: "Beta", selo: 3, grupo: "Um" }, { id: "c", rotulo: "Gama", grupo: "Dois" },
];
function Exemplo({ recolhivel = false }: { recolhivel?: boolean }) {
  const [a, setA] = useState<"a" | "b" | "c">("a");
  return <SubNavegacao base="x" rotulo="Seções" itens={ITENS} ativo={a} onMudar={setA} recolhivel={recolhivel} barra={<div role="toolbar" aria-label="barra">controles</div>}><p>painel {a}</p></SubNavegacao>;
}

describe("SubNavegacao", () => {
  it("tablist vertical com tab/tabpanel ligados por id, só o ativo no Tab e títulos de grupo", () => {
    render(<Exemplo />);
    const lista = screen.getByRole("tablist", { name: "Seções" });
    expect(lista.getAttribute("aria-orientation")).toBe("vertical");
    const abas = screen.getAllByRole("tab");
    expect(abas.map((t) => t.textContent)).toEqual(["Alfa", "Beta3", "Gama"]);
    expect(abas.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    const painel = screen.getByRole("tabpanel");
    expect(painel.id).toBe(idPainel("x"));
    expect(painel.getAttribute("aria-labelledby")).toBe(idAba("x", "a"));
    expect(abas[0]?.getAttribute("aria-controls")).toBe(painel.id);
    expect(screen.getByText("Um")).toBeTruthy();
    expect(screen.getByText("Dois")).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "barra" })).toBeTruthy();
  });
  it("clique, ↓/↑, Home/End trocam a aba e movem o foco", async () => {
    render(<Exemplo />);
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Gama" })); });
    expect(screen.getByText("painel c")).toBeTruthy();
    const gama = screen.getByRole("tab", { name: "Gama" });
    await act(async () => { gama.focus(); fireEvent.keyDown(gama, { key: "ArrowDown" }); });
    expect(screen.getByRole("tab", { name: "Alfa" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Alfa" }));
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "End" }); });
    expect(screen.getByRole("tab", { name: "Gama" }).getAttribute("aria-selected")).toBe("true");
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" }); });
    expect(screen.getByRole("tab", { name: "Beta3" }).getAttribute("aria-selected")).toBe("true");
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "Home" }); });
    expect(screen.getByText("painel a")).toBeTruthy();
  });
  it("a barra é discreta e fixa: não existe botão de recolher, mesmo com a prop antiga `recolhivel`", () => {
    const { container } = render(<Exemplo recolhivel />);
    expect(screen.queryByRole("button", { name: /navegação lateral/ })).toBeNull();
    expect(container.querySelector(".subnav")?.hasAttribute("data-recolhido")).toBe(false);
  });
});
