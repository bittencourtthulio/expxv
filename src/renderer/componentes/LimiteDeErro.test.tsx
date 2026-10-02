// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LimiteDeErro } from "./LimiteDeErro";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

let quebrar = true;
function Instavel() {
  if (quebrar) throw new Error("falha de teste");
  return <p>tela ok</p>;
}

describe("LimiteDeErro", () => {
  it("isola a falha: mostra o aviso da tela, mantém o resto da página e esconde o detalhe técnico", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    quebrar = true;
    render(<div><nav>menu</nav><LimiteDeErro nome="Mapa"><Instavel /></LimiteDeErro></div>);
    expect(screen.getByText("menu")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("A tela Mapa não abriu");
    expect(screen.getByText("falha de teste")).toBeTruthy();
  });

  it("'Tentar de novo' remonta a tela quando o problema passou", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    quebrar = true;
    render(<LimiteDeErro nome="Harness"><Instavel /></LimiteDeErro>);
    quebrar = false;
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(screen.getByText("tela ok")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sem erro, só renderiza os filhos", () => {
    quebrar = false;
    render(<LimiteDeErro nome="Início"><Instavel /></LimiteDeErro>);
    expect(screen.getByText("tela ok")).toBeTruthy();
  });
});
