// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RotuloPane } from "./RotuloPane";
import { carregarPerfisDeAgentes, textoDoPerfil, usePerfisDeAgentes, zerarPerfisDeAgentes } from "./perfis-agentes";
import { mapaDeDetalhes, rotuloMissao, type InfoPane } from "./missao";

const perfil = { rotulo: "Impl", perfil: { cli: "claude", modelo: "opus", esforco: "high", faixa: "alto" as const } };
afterEach(() => zerarPerfisDeAgentes());

describe("RotuloPane", () => {
  it("sem agente: só o rótulo (MVP), sem foco extra", () => {
    render(<RotuloPane rotulo="#1 · Claude · piloto · M" />);
    const el = screen.getByText("#1 · Claude · piloto · M");
    expect(el.getAttribute("tabindex")).toBeNull();
    expect(el.getAttribute("title")).toBe("#1 · Claude · piloto · M");
  });
  it("com agente: modelo · esforço (indicativo) no title/rótulo e focável", () => {
    render(<RotuloPane rotulo="#2 · Claude · Impl · M" perfil={perfil} />);
    const el = screen.getByLabelText(/opus · high \(indicativo\)/);
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.getAttribute("title")).toContain("opus · high (indicativo)");
  });
  it("perfil sem modelo/esforço mostra o padrão", () => {
    expect(textoDoPerfil({ rotulo: "x", perfil: { cli: "codex", modelo: null, esforco: null, faixa: "alto" } })).toBe("modelo padrão · esforço padrão (indicativo)");
  });
});

describe("rótulo da Missão com agente", () => {
  const base: InfoPane = { sessaoId: "s", displayId: 7, papel: "executor", ehPiloto: false, missaoId: "m", missaoTitulo: "Login" };
  it("troca o papel pelo agente quando há perfil", () => {
    expect(rotuloMissao(base, "Claude Code")).toBe("#7 · Claude Code · executor · Login");
    expect(rotuloMissao({ ...base, agenteId: "alfa.impl" }, "Claude Code", "Impl")).toBe("#7 · Claude Code · Impl · Login");
  });
  it("mapaDeDetalhes carrega o agente do Pane", () => {
    const d = { mission: { id: "m", modo: "squad", estado: "executando", titulo: "T", workspace_id: "w", worktree: null }, panes: [{ id: "p", mission_id: "m", sessao_pty_id: "s1", display_id: 1, cli: "claude", papel: "executor", eh_piloto: false, respawn_de: null, agente_id: "alfa.impl" }] } as never;
    expect(mapaDeDetalhes({ m: d })["s1"]?.agenteId).toBe("alfa.impl");
  });
});

describe("cache de perfis", () => {
  function Sonda({ ids, api }: { ids: string[]; api: never }) {
    const m = usePerfisDeAgentes(ids, api);
    return <p>{m.size}</p>;
  }
  it("carrega UMA vez para vários renders e panes", async () => {
    const listar = vi.fn(async () => [{ agent_id: "alfa.impl", squad: "alfa", rotulo: "Impl", papel: "executor", perfil: perfil.perfil, vivos: 0 }]);
    const api = { listar } as never;
    const { rerender } = render(<Sonda ids={["alfa.impl", "alfa.impl"]} api={api} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    rerender(<Sonda ids={["alfa.impl"]} api={api} />);
    rerender(<Sonda ids={["alfa.impl"]} api={api} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(listar).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1")).toBeTruthy();
  });
  it("sem Pane com agente não chama a API", async () => {
    const listar = vi.fn(async () => []);
    render(<Sonda ids={[]} api={{ listar } as never} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(listar).not.toHaveBeenCalled();
    await carregarPerfisDeAgentes({ listar: async () => { throw new Error("x"); } } as never);
  });
});
