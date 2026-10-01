// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DetalheMissao as Dados, EstadoPortoes, Mission } from "../../../compartilhado/dominio";
import { criarStoreMissoes, useMissoes } from "../../estado/missoes";
import { DetalheMissao } from "./Detalhe";

afterEach(cleanup);

const mission: Mission = { id: "m1", workspace_id: "w1", modo: "agentico", origem: "feature", trabalho_id: null, titulo: "Login", estado: "executando", worktree: null, branch: null, piloto_pane_id: "p1", concluida_em: null, criado_em: "x", atualizado_em: "x" };
const sem: EstadoPortoes = { mission_id: "m1", liberados: [], pendentes: ["direction", "content", "build", "qa"] };
const dados = (m: Partial<Mission> = {}): Dados => ({ mission: { ...mission, ...m }, panes: [], tasks: [], handoffs: [] });

function montar(opcoes: { missao?: Partial<Mission>; portoes?: EstadoPortoes | null; liberar?: ReturnType<typeof vi.fn<(id: string, p: string) => Promise<EstadoPortoes | null>>> } = {}) {
  let aoEvento: ((e: { workspace_id: string; mission_id: string | null }) => void) | null = null;
  let portoes: EstadoPortoes | null = opcoes.portoes === undefined ? sem : opcoes.portoes;
  const api = {
    listar: vi.fn().mockResolvedValue({ itens: [mission], proximo: null }),
    criar: vi.fn(),
    detalhe: vi.fn().mockImplementation(async () => dados(opcoes.missao)),
    encerrar: vi.fn(), abortar: vi.fn(),
    portoes: vi.fn().mockImplementation(async () => portoes),
    liberarPortao: opcoes.liberar ?? vi.fn<(id: string, p: string) => Promise<EstadoPortoes | null>>().mockImplementation(async (_id, p) => {
      portoes = { mission_id: "m1", liberados: [...(portoes?.liberados ?? []), p as never], pendentes: (portoes?.pendentes ?? []).filter((x) => x !== p) };
      return portoes;
    }),
    assinar: vi.fn((cb: (e: { workspace_id: string; mission_id: string | null }) => void) => { aoEvento = cb; return () => undefined; }),
  };
  const store = criarStoreMissoes({ api: () => api, agendar: (fn) => { fn(); return () => undefined; } });
  const Wrap = () => {
    const est = useMissoes(store);
    return <DetalheMissao id="m1" store={store} detalhe={est.detalhes.m1} portoes={est.portoes.m1} aoVoltar={() => undefined} />;
  };
  const abrir = async () => {
    await store.definirWorkspace("w1");
    render(<Wrap />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  };
  return { api, store, abrir, evento: async () => { await act(async () => { aoEvento?.({ workspace_id: "w1", mission_id: "m1" }); await Promise.resolve(); await Promise.resolve(); }); }, mudar: (p: EstadoPortoes) => { portoes = p; } };
}

const linha = (portao: string) => screen.getByRole("list", { name: "Estado dos portões" }).querySelector(`[data-portao="${portao}"]`) as HTMLElement;

describe("painel de portões no Detalhe da missão", () => {
  it("mostra os quatro portões, uma linha cada, com ícone + texto de estado e botão só nos pendentes", async () => {
    const m = montar({ portoes: { mission_id: "m1", liberados: ["direction"], pendentes: ["content", "build", "qa"] } });
    await m.abrir();
    expect(screen.getByRole("region", { name: "Portões" })).toBeTruthy();
    expect(screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-portao"))).toHaveLength(4);
    expect(within(linha("direction")).getByText("liberado")).toBeTruthy();
    expect(within(linha("direction")).queryByRole("button")).toBeNull();
    expect(linha("direction").querySelector("svg")).not.toBeNull();
    for (const p of ["content", "build", "qa"]) {
      expect(within(linha(p)).getByText("pendente")).toBeTruthy();
      expect(within(linha(p)).getByRole("button", { name: /^Liberar / })).toBeTruthy();
    }
  });

  it("avisa que o piloto fica bloqueado por gate_pending enquanto há portão pendente de worker", async () => {
    const m = montar();
    await m.abrir();
    expect(screen.getByRole("status").textContent).toMatch(/gate_pending/);
    expect(screen.getByRole("status").textContent).toMatch(/explorador, executor, revisor/);
  });

  it("sem portão pendente não há aviso", async () => {
    const m = montar({ portoes: { mission_id: "m1", liberados: ["direction", "content", "build", "qa"], pendentes: [] } });
    await m.abrir();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Liberar / })).toBeNull();
  });

  it("liberar pede confirmação pelo Dialogo (nunca window.confirm); cancelar não libera; confirmar libera", async () => {
    const nativo = vi.spyOn(window, "confirm");
    const m = montar();
    await m.abrir();
    fireEvent.click(within(linha("build")).getByRole("button"));
    let d = screen.getByRole("dialog", { name: "Liberar o portão Construção?" });
    expect(m.api.liberarPortao).not.toHaveBeenCalled();
    fireEvent.click(within(d).getByRole("button", { name: "Cancelar" }));
    expect(m.api.liberarPortao).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(within(linha("build")).getByRole("button"));
    d = screen.getByRole("dialog", { name: "Liberar o portão Construção?" });
    await act(async () => { fireEvent.click(within(d).getByRole("button", { name: "Liberar portão" })); });
    expect(m.api.liberarPortao).toHaveBeenCalledWith("m1", "build");
    expect(nativo).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(linha("build")).getByText("liberado")).toBeTruthy();
    expect(within(linha("build")).queryByRole("button")).toBeNull();
  });

  it("falha ao liberar vira alerta no painel (sem travar a tela)", async () => {
    const m = montar({ liberar: vi.fn().mockRejectedValue(new Error("A Missão já foi encerrada")) });
    await m.abrir();
    fireEvent.click(within(linha("qa")).getByRole("button"));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Liberar portão" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/encerrada/);
    expect(within(linha("qa")).getByText("pendente")).toBeTruthy();
  });

  it("atualiza por evento coalescido (missoes:mudou) quando o portão muda por outro caminho", async () => {
    const m = montar();
    await m.abrir();
    expect(within(linha("direction")).getByText("pendente")).toBeTruthy();
    m.mudar({ mission_id: "m1", liberados: ["direction"], pendentes: ["content", "build", "qa"] });
    await m.evento();
    expect(within(linha("direction")).getByText("liberado")).toBeTruthy();
  });

  it("missão terminal mostra o estado mas não oferece Liberar; modo livre não mostra o painel", async () => {
    const t = montar({ missao: { estado: "abortada" } });
    await t.abrir();
    expect(screen.getByRole("region", { name: "Portões" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Liberar / })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    const l = montar({ missao: { modo: "livre" } });
    await l.abrir();
    expect(screen.queryByRole("region", { name: "Portões" })).toBeNull();
  });

  it("sem estado de portões (API ausente ou missão sem registro) não há painel", async () => {
    const m = montar({ portoes: null });
    await m.abrir();
    expect(screen.queryByRole("region", { name: "Portões" })).toBeNull();
  });
});
