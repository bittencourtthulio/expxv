import { afterEach, describe, expect, it } from "vitest";
import { criarCard, montarMain, type MundoMain } from "../../tests/fixtures/alertas/mundo-main";
import { limpar } from "../../tests/fixtures/dominio/ambiente";
import { criarServicoPortoes } from "../nucleo/orquestracao/portoes";
import { criarConsultaTelegram, criarGatesTelegram } from "./alertas-consulta";

let m: MundoMain;
afterEach(() => {
  m?.l.encerrar();
  limpar();
});
const consulta = () => criarConsultaTelegram({ banco: m.banco, nomeWorkspace: (id) => m.repos.workspace.obter(id)?.nome ?? null, dadosDaTask: () => ({ tempo_trabalho_ms: 60_000, tokens: 10, story_points: 3, atraso_ms: null, limite_ms: null }), cotaGeralPct: () => 42, criticosNaoLidos: () => 1 });

describe("consultas do Telegram: SÓ dos workspaces recebidos, só leitura", () => {
  it("missões ativas e tarefas em andamento vêm só do workspace permitido (outro workspace nunca vaza)", async () => {
    m = montarMain();
    const c = criarCard(m);
    m.repos.task.mudarEstado(c.task_id, "reivindicada", { pane_id: c.pane_id });
    const outro = m.repos.workspace.criar({ nome: "segredo-do-cliente", raiz: m.ws ? `${m.repos.workspace.obter(m.ws.id)?.raiz}-2` : "/tmp/x" });
    const mis2 = m.repos.mission.criar({ workspace_id: outro.id, modo: "agentico", origem: "feature", titulo: "Missão do outro", trabalho_id: "OC-9" });
    m.repos.task.criar({ mission_id: mis2.id, task_ref: "T-9.9", titulo: "Tarefa do outro", papel: "executor" });
    const q = consulta();
    const mis = await q.missoesAtivas([m.ws.id]);
    expect(mis.map((x) => x.titulo)).toEqual(["Corrigir o login"]);
    const em = await q.tarefasEmAndamento([m.ws.id], 5);
    expect(em).toMatchObject([{ task_id: "T-1.1", story_points: 3, tempo_trabalho_ms: 60_000, tokens: 10 }]);
    expect(JSON.stringify([mis, em, await q.proximasTarefas?.([m.ws.id], 5)])).not.toContain("outro");
    expect(await q.missoesAtivas([])).toEqual([]);
    expect(q.nomeWorkspace(m.ws.id)).toBe("app-web");
    expect(q.cotaGeralPct()).toBe(42);
    expect(q.alertasCriticosNaoLidos()).toBe(1);
  });
  it("atrasadas: só as com atraso conhecido", async () => {
    m = montarMain();
    const c = criarCard(m);
    m.repos.task.mudarEstado(c.task_id, "reivindicada", { pane_id: c.pane_id });
    const q = criarConsultaTelegram({ banco: m.banco, nomeWorkspace: () => null, dadosDaTask: () => ({ tempo_trabalho_ms: 1, tokens: null, story_points: null, atraso_ms: 37 * 60_000, limite_ms: 45 * 60_000 }), cotaGeralPct: () => null, criticosNaoLidos: () => 0 });
    expect((await q.atrasadas([m.ws.id])).map((x) => x.task_id)).toEqual(["T-1.1"]);
    expect(await consulta().atrasadas([m.ws.id])).toEqual([]);
  });
});

describe("gates: só os portões de intake; decidir libera pelo serviço real e recusar não grava", () => {
  it("lista os 4 portões pendentes da Missão ativa, nunca exige humano; aprovar libera; recusar mantém fechado; id inválido é recusado", async () => {
    m = montarMain();
    const c = criarCard(m);
    const g = criarGatesTelegram({ banco: m.banco, config: m.repos.config, portoes: criarServicoPortoes({ repos: m.repos, banco: m.banco, aoMudar: () => undefined }) });
    const pend = await g.pendentes([m.ws.id]);
    expect(pend.map((x) => x.id)).toEqual([`${c.mission_id}:direction`, `${c.mission_id}:content`, `${c.mission_id}:build`, `${c.mission_id}:qa`]);
    expect(pend.every((x) => x.exige_humano === false)).toBe(true);
    expect(await g.decidir(`${c.mission_id}:build`, "recusar", "telegram:5")).toEqual({ ok: true });
    expect((await g.pendentes([m.ws.id])).length).toBe(4);
    expect(await g.decidir(`${c.mission_id}:build`, "aprovar", "telegram:5")).toEqual({ ok: true });
    expect((await g.pendentes([m.ws.id])).map((x) => x.id)).not.toContain(`${c.mission_id}:build`);
    expect(await g.decidir("lixo", "aprovar", "x")).toMatchObject({ ok: false });
    expect(await g.decidir(`${c.mission_id}:merge`, "aprovar", "x")).toMatchObject({ ok: false });
    expect(await g.pendentes([])).toEqual([]);
  });
});
