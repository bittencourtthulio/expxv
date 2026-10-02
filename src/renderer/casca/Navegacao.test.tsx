// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Navegacao } from "./Navegacao";
import { atualizarMontadas, type TelaId } from "./telas";

/** Vai a uma tela pelo menu; se ela estiver num grupo fechado, abre o grupo antes (como a pessoa faria). */
const ir = async (nome: string) => {
  const achar = () => screen.queryByRole("button", { name: nome });
  if (achar() === null) {
    for (const cab of screen.getAllByRole("button", { expanded: false })) {
      if (achar() !== null) break;
      await act(async () => { fireEvent.click(cab); });
    }
  }
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: nome }));
  });
};
beforeEach(() => { try { localStorage.clear(); } catch { /* sem storage */ } });
const montadas = () => [...document.querySelectorAll("[data-tela]")].map((e) => e.getAttribute("data-tela"));
const visivel = () => [...document.querySelectorAll("[data-tela]:not([hidden])")].map((e) => e.getAttribute("data-tela"));

describe("Navegacao", () => {
  it("começa em Início com aria-current e carrega a tela sob demanda", async () => {
    render(<Navegacao />);
    expect(screen.getByRole("button", { name: "Início" }).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByRole("heading", { name: "Hoje" })).toBeTruthy();
    expect(montadas()).toEqual(["inicio"]);
  });

  it("troca de tela move aria-current e oculta (não desmonta) a anterior", async () => {
    render(<Navegacao />);
    await ir("Missões");
    expect(screen.getByRole("button", { name: "Missões" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Início" }).getAttribute("aria-current")).toBeNull();
    expect(await screen.findByRole("heading", { name: "Quadro" })).toBeTruthy();
    expect(visivel()).toEqual(["missoes"]);
    expect(montadas()).toContain("inicio");
  });

  it("mantém só as 4 últimas montadas e Terminais sempre depois de visitada", async () => {
    render(<Navegacao />);
    await ir("Terminais");
    for (const n of ["Método", "Workspaces", "Provedores", "Configurações", "Missões"]) await ir(n);
    const m = montadas();
    expect(m).toContain("terminais");
    expect(m).not.toContain("inicio");
    expect(m.filter((t) => t !== "terminais")).toHaveLength(4);
    expect(visivel()).toEqual(["missoes"]);
  });
});

describe("atualizarMontadas", () => {
  it("é uma lista MRU de até 4 telas, com terminais fora do limite", () => {
    let l: TelaId[] = [];
    for (const t of ["terminais", "inicio", "missoes", "metodo", "workspaces", "provedores"] as TelaId[]) l = atualizarMontadas(l, t);
    expect(l).toContain("terminais");
    expect(l.filter((t) => t !== "terminais")).toEqual(["provedores", "workspaces", "metodo", "missoes"]);
  });

  it("revisitar não duplica e promove a tela ao topo", () => {
    const l = atualizarMontadas(atualizarMontadas(atualizarMontadas([], "inicio"), "missoes"), "inicio");
    expect(l).toEqual(["inicio", "missoes"]);
  });
});
