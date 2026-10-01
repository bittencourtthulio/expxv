import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../index";
import { DuplicadoErro, ResumoLongoErro, ValidacaoSemRevisorErro, type Papel } from "../../dominio";
import { criarRepoHandoff } from "./handoff";
import { criarRepoMission } from "./mission";
import { criarRepoPane } from "./pane";
import { criarRepoTask } from "./task";
import { criarRepoWorkspace } from "./workspace";

const abertos: Banco[] = [];
function novo() {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  const ws = criarRepoWorkspace(b).criar({ nome: "w", raiz: "/w" });
  const m = criarRepoMission(b).criar({ workspace_id: ws.id, modo: "agentico", origem: "feature", titulo: "t" });
  const panes = criarRepoPane(b);
  const pane = (papel: Papel) => panes.criar({ workspace_id: ws.id, mission_id: m.id, tipo: "cli", papel: papel === "piloto" ? "nenhum" : papel }).id;
  return { b, ws, m, pane, tasks: criarRepoTask(b), handoffs: criarRepoHandoff(b) };
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

describe("repo task", () => {
  it("cria aberta com id task_ e recusa task_ref repetido na Missão", () => {
    const { tasks, m } = novo();
    const t = tasks.criar({ mission_id: m.id, task_ref: "T-01.01", titulo: "a", papel: "executor" });
    expect(t.id).toMatch(/^task_/);
    expect(t).toMatchObject({ estado: "aberta", handoff_id: null, pane_id: null });
    expect(() => tasks.criar({ mission_id: m.id, task_ref: "T-01.01", titulo: "b", papel: "executor" })).toThrow(DuplicadoErro);
  });

  it("fluxo aberta → reivindicada → entregue registra o Pane", () => {
    const { tasks, m, pane } = novo();
    const t = tasks.criar({ mission_id: m.id, task_ref: "t-1", titulo: "a", papel: "executor" });
    const p = pane("executor");
    expect(tasks.mudarEstado(t.id, "reivindicada", { pane_id: p })).toMatchObject({ estado: "reivindicada", pane_id: p });
    expect(tasks.mudarEstado(t.id, "entregue").estado).toBe("entregue");
  });

  it("validada sem nenhum handoff é rejeitada", () => {
    const { tasks, m } = novo();
    const t = tasks.criar({ mission_id: m.id, task_ref: "t-1", titulo: "a", papel: "executor" });
    tasks.mudarEstado(t.id, "entregue");
    expect(() => tasks.mudarEstado(t.id, "validada")).toThrow(ValidacaoSemRevisorErro);
    expect(tasks.obter(t.id)?.estado).toBe("entregue");
  });

  it("validada com handoff ok de executor (não revisor) é rejeitada", () => {
    const { tasks, handoffs, m, pane } = novo();
    const t = tasks.criar({ mission_id: m.id, task_ref: "t-1", titulo: "a", papel: "executor" });
    handoffs.criar({ task_id: t.id, de_pane_id: pane("executor"), resumo: "feito", status: "ok" });
    expect(() => tasks.mudarEstado(t.id, "validada")).toThrow(ValidacaoSemRevisorErro);
  });

  it("validada com handoff de revisor mas status parcial é rejeitada", () => {
    const { tasks, handoffs, m, pane } = novo();
    const t = tasks.criar({ mission_id: m.id, task_ref: "t-1", titulo: "a", papel: "executor" });
    tasks.mudarEstado(t.id, "entregue");
    handoffs.criar({ task_id: t.id, de_pane_id: pane("revisor"), resumo: "quase", status: "parcial" });
    expect(() => tasks.mudarEstado(t.id, "validada")).toThrow(ValidacaoSemRevisorErro);
  });

  it("validada com handoff ok de revisor passa e aponta handoff_id para ele", () => {
    const { tasks, handoffs, m, pane } = novo();
    const t = tasks.criar({ mission_id: m.id, task_ref: "t-1", titulo: "a", papel: "executor" });
    handoffs.criar({ task_id: t.id, de_pane_id: pane("executor"), resumo: "feito", status: "ok" });
    tasks.mudarEstado(t.id, "entregue");
    const h = handoffs.criar({ task_id: t.id, de_pane_id: pane("revisor"), resumo: "revisado", status: "ok" });
    const v = tasks.mudarEstado(t.id, "validada");
    expect(v).toMatchObject({ estado: "validada", handoff_id: h.id });
  });

  it("transições de task inválidas (a partir de terminal) são recusadas", () => {
    const { tasks, m } = novo();
    const t = tasks.criar({ mission_id: m.id, task_ref: "t-1", titulo: "a", papel: "executor" });
    tasks.mudarEstado(t.id, "descartada");
    expect(() => tasks.mudarEstado(t.id, "entregue")).toThrow();
  });

  it("lista por Missão com filtro de estado", () => {
    const { tasks, m } = novo();
    const a = tasks.criar({ mission_id: m.id, task_ref: "t-1", titulo: "a", papel: "executor" });
    tasks.criar({ mission_id: m.id, task_ref: "t-2", titulo: "b", papel: "executor" });
    tasks.mudarEstado(a.id, "reivindicada");
    expect(tasks.listarPorMissao(m.id).itens).toHaveLength(2);
    expect(tasks.listarPorMissao(m.id, { estado: "reivindicada" }).itens.map((t) => t.id)).toEqual([a.id]);
  });
});

describe("repo handoff", () => {
  it("cria com id hof_, atualiza task.handoff_id e lista por task", () => {
    const { tasks, handoffs, m } = novo();
    const t = tasks.criar({ mission_id: m.id, task_ref: "t-1", titulo: "a", papel: "executor" });
    const h = handoffs.criar({ task_id: t.id, resumo: "ok", status: "ok" });
    expect(h.id).toMatch(/^hof_/);
    expect(tasks.obter(t.id)?.handoff_id).toBe(h.id);
    expect(handoffs.listarPorTask(t.id).map((x) => x.id)).toEqual([h.id]);
  });

  it("resumo de 400 caracteres passa; 401 é rejeitado com erro nominal; vazio também", () => {
    const { tasks, handoffs, m } = novo();
    const t = tasks.criar({ mission_id: m.id, task_ref: "t-1", titulo: "a", papel: "executor" });
    expect(handoffs.criar({ task_id: t.id, resumo: "é".repeat(400), status: "ok" }).resumo).toHaveLength(400);
    expect(() => handoffs.criar({ task_id: t.id, resumo: "x".repeat(401), status: "ok" })).toThrow(ResumoLongoErro);
    expect(() => handoffs.criar({ task_id: t.id, resumo: "  ", status: "ok" })).toThrow();
  });
});
