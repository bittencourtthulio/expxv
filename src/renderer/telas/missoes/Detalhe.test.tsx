// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DetalheMissao as Dados, Mission } from "../../../compartilhado/dominio";
import { criarStoreMissoes } from "../../estado/missoes";
import { Custo } from "./Custo";
import { DetalheMissao } from "./Detalhe";
import { rotuloPane } from "./rotulos";

const mission: Mission = { id: "m1", workspace_id: "w1", modo: "squad", origem: "feature", trabalho_id: null, titulo: "Login", estado: "executando", worktree: null, branch: "feature/login", piloto_pane_id: "p1", concluida_em: null, criado_em: "x", atualizado_em: "x" };
const dados: Dados = {
  mission,
  panes: [{ id: "p1", mission_id: "m1", workspace_id: "w1", display_id: 3, tipo: "cli", cli: "claude", executavel_id: null, conta_id: null, modelo: null, esforco: null, papel: "piloto", eh_piloto: true, estado: "aguardando", sessao_pty_id: null, respawn_de: null, cwd: null, encerrado_motivo: null, criado_em: "x", atualizado_em: "x" }],
  tasks: [{ id: "t1", mission_id: "m1", task_ref: "T-1", titulo: "Criar rota", briefing_path: null, papel: "executor", estado: "aberta", pane_id: null, handoff_id: null, criado_em: "x", atualizado_em: "x" }],
  handoffs: [{ id: "h1", task_id: "t1", de_pane_id: null, para_pane_id: null, resumo: "Rota pronta", relatorio_path: null, status: "ok", criado_em: "x", atualizado_em: "x" }],
};

function montar(estado: Mission["estado"] = "executando") {
  const api = {
    listar: vi.fn().mockResolvedValue({ itens: [{ ...mission, estado }], proximo: null }), criar: vi.fn(), detalhe: vi.fn().mockResolvedValue({ ...dados, mission: { ...mission, estado } }),
    encerrar: vi.fn().mockResolvedValue(null), abortar: vi.fn().mockResolvedValue(null), portoes: vi.fn().mockResolvedValue(null), liberarPortao: vi.fn().mockResolvedValue(null), assinar: vi.fn(() => () => undefined),
  };
  const store = criarStoreMissoes({ api: () => api });
  const Wrap = () => {
    const d = store.obter().detalhes.m1;
    return <DetalheMissao id="m1" store={store} detalhe={d} aoVoltar={() => undefined} />;
  };
  return { api, store, Wrap };
}

describe("Detalhe da missão", () => {
  it("rótulo do Pane segue #<n> · <CLI> · <papel> · <missão>", () => {
    expect(rotuloPane({ display_id: 3, cli: "claude", papel: "piloto" }, "Login")).toBe("#3 · claude · piloto · Login");
  });
  it("renderiza Panes, tasks e handoffs e custo desconhecido como texto, nunca 0", async () => {
    const { store, Wrap } = montar();
    await store.definirWorkspace("w1");
    const { rerender } = render(<Wrap />);
    await act(async () => { await store.observarDetalhe("m1"); });
    rerender(<Wrap />);
    expect(screen.getByText("#3 · claude · piloto · Login")).toBeTruthy();
    expect(screen.getByText("Criar rota")).toBeTruthy();
    expect(screen.getByText("Rota pronta")).toBeTruthy();
    expect(screen.getByText("custo desconhecido")).toBeTruthy();
    expect(screen.queryByText(/US\$ 0/)).toBeNull();
  });
  it("Custo: desconhecido vira texto; 0 real continua 0", () => {
    const { rerender } = render(<Custo valor={null} />);
    expect(screen.getByText("custo desconhecido")).toBeTruthy();
    rerender(<Custo valor={undefined} />);
    expect(screen.getByText("custo desconhecido")).toBeTruthy();
    rerender(<Custo valor={0} />);
    expect(screen.getByText("US$ 0.00")).toBeTruthy();
  });
  it("abortar pede confirmação pela UI (sem window.confirm) e só então aborta", async () => {
    const nativo = vi.spyOn(window, "confirm");
    const { api, store, Wrap } = montar();
    await store.definirWorkspace("w1");
    const { rerender } = render(<Wrap />);
    await act(async () => { await store.observarDetalhe("m1"); });
    rerender(<Wrap />);
    fireEvent.click(screen.getByRole("button", { name: "Abortar" }));
    const d = screen.getByRole("dialog", { name: "Abortar a missão?" });
    expect(api.abortar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(d).getByRole("button", { name: "Abortar" })); });
    expect(api.abortar).toHaveBeenCalledWith("m1");
    expect(nativo).not.toHaveBeenCalled();
  });
  it("cancelar o encerramento não encerra; missão terminal não oferece encerrar/abortar", async () => {
    const { api, store, Wrap } = montar();
    await store.definirWorkspace("w1");
    const { rerender, unmount } = render(<Wrap />);
    await act(async () => { await store.observarDetalhe("m1"); });
    rerender(<Wrap />);
    fireEvent.click(screen.getByRole("button", { name: "Encerrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(api.encerrar).not.toHaveBeenCalled();
    unmount();
    const t = montar("concluida");
    await t.store.definirWorkspace("w1");
    const r = render(<t.Wrap />);
    await act(async () => { await t.store.observarDetalhe("m1"); });
    r.rerender(<t.Wrap />);
    expect(screen.queryByRole("button", { name: "Abortar" })).toBeNull();
  });
});
