import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../index";
import { criarRepositorios } from "./index";
import { NaoEncontradoErro, ValorInvalidoErro } from "../../dominio";

const abertos: Banco[] = [];
function novo() {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  const r = criarRepositorios(b);
  const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
  return { b, r, ws };
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const H = "b".repeat(64);
const base = { modo: "squad", origem: "livre", titulo: "M" } as const;

describe("repos Mission/Pane com squad_id e agente_id", () => {
  it("criar sem squad_id não muda o comportamento; com squad_id grava e lê", () => {
    const { r, ws } = novo();
    const sem = r.mission.criar({ workspace_id: ws.id, ...base });
    expect(sem.squad_id ?? null).toBeNull();
    const com = r.mission.criar({ workspace_id: ws.id, ...base, squad_id: "feature-fullstack" });
    expect(r.mission.exigir(com.id).squad_id).toBe("feature-fullstack");
    const p = r.pane.criar({ workspace_id: ws.id, mission_id: com.id, tipo: "cli", papel: "piloto", agente_id: "feature-fullstack.orquestrador" });
    expect(r.pane.exigir(p.id).agente_id).toBe("feature-fullstack.orquestrador");
    const livre = r.pane.criar({ workspace_id: ws.id, tipo: "shell" });
    expect(r.pane.exigir(livre.id).agente_id ?? null).toBeNull();
  });
});

describe("repo mission-squad", () => {
  it("grava o snapshot, sincroniza mission.squad_id e é regravável (upsert)", () => {
    const { r, ws } = novo();
    const m = r.mission.criar({ workspace_id: ws.id, ...base });
    const ms = r.missionSquad.gravar({ mission_id: m.id, squad_slug: "s1", squad_hash: H, portoes_pendentes: ["build"], nivel_rigidez: 3, plano_antes: true });
    expect(ms).toMatchObject({ squad_slug: "s1", portoes_pendentes: ["build"], nivel_rigidez: 3, plano_antes: true });
    expect(r.mission.exigir(m.id).squad_id).toBe("s1");
    const de = r.missionSquad.gravar({ mission_id: m.id, squad_slug: "s1", squad_hash: "c".repeat(64), plano_antes: false });
    expect(de).toMatchObject({ squad_hash: "c".repeat(64), plano_antes: false, portoes_pendentes: [], nivel_rigidez: null });
    expect(r.missionSquad.obter("mis_nada")).toBeUndefined();
    expect(() => r.missionSquad.exigir("mis_nada")).toThrow(NaoEncontradoErro);
  });

  it("recusa Missão inexistente, hash ruim, portão desconhecido e rigidez fora de 1..5 sem gravar nada", () => {
    const { r, ws } = novo();
    const m = r.mission.criar({ workspace_id: ws.id, ...base });
    expect(() => r.missionSquad.gravar({ mission_id: "mis_x", squad_slug: "s", squad_hash: H })).toThrow(NaoEncontradoErro);
    expect(() => r.missionSquad.gravar({ mission_id: m.id, squad_slug: "s", squad_hash: "x" })).toThrow(ValorInvalidoErro);
    expect(() => r.missionSquad.gravar({ mission_id: m.id, squad_slug: "s", squad_hash: H, portoes_pendentes: ["deploy" as never] })).toThrow(ValorInvalidoErro);
    expect(() => r.missionSquad.gravar({ mission_id: m.id, squad_slug: "s", squad_hash: H, nivel_rigidez: 6 })).toThrow(ValorInvalidoErro);
    expect(r.missionSquad.obter(m.id)).toBeUndefined();
    expect(r.mission.exigir(m.id).squad_id ?? null).toBeNull();
  });

  it("emUso: só Missão ativa conta; terminal libera a squad", () => {
    const { r, ws } = novo();
    const m = r.mission.criar({ workspace_id: ws.id, ...base });
    r.missionSquad.gravar({ mission_id: m.id, squad_slug: "usada", squad_hash: H });
    expect(r.missionSquad.emUso("usada")).toBe(true);
    expect(r.missionSquad.emUso("outra")).toBe(false);
    expect(r.missionSquad.slugsEmUso()).toEqual(["usada"]);
    r.mission.transicionar(m.id, "abortada");
    expect(r.missionSquad.emUso("usada")).toBe(false);
    expect(r.missionSquad.slugsEmUso()).toEqual([]);
  });
});

describe("repo invocacao-agente", () => {
  it("abre, conta vivas por Missão/agente, fecha (idempotente) e fecha por Pane", () => {
    const { r, ws } = novo();
    const m = r.mission.criar({ workspace_id: ws.id, ...base });
    const p1 = r.pane.criar({ workspace_id: ws.id, mission_id: m.id, tipo: "cli", papel: "piloto" });
    const p2 = r.pane.criar({ workspace_id: ws.id, mission_id: m.id, tipo: "cli", papel: "executor" });
    const a = r.invocacaoAgente.abrir({ mission_id: m.id, pane_id: p1.id, agente_id: "s.impl", task_ref: "T-1", perfil: { cli: "claude", modelo: "sonnet", esforco: "medio", esforco_modo: "flag" }, prompt_hash: "h1", recibo: "ok" });
    r.invocacaoAgente.abrir({ mission_id: m.id, pane_id: p2.id, agente_id: "s.impl", perfil: {}, prompt_hash: "h2" });
    r.invocacaoAgente.abrir({ mission_id: m.id, agente_id: "s.rev", perfil: {}, prompt_hash: "h3" });
    expect(a.id).toMatch(/^inv_/);
    expect(a.perfil).toMatchObject({ cli: "claude", esforco_modo: "flag" });
    expect(r.invocacaoAgente.contarVivas(m.id)).toBe(3);
    expect(r.invocacaoAgente.contarVivas(m.id, "s.impl")).toBe(2);
    expect(r.invocacaoAgente.vivasPorAgente("s")).toEqual({ "s.impl": 2, "s.rev": 1 });
    expect(r.invocacaoAgente.vivasPorAgente("outra")).toEqual({});
    const f = r.invocacaoAgente.fechar(a.id, "2999-01-01T00:00:00.000Z");
    expect(f.encerrada_em).toBe("2999-01-01T00:00:00.000Z");
    expect(r.invocacaoAgente.fechar(a.id).encerrada_em).toBe("2999-01-01T00:00:00.000Z");
    expect(r.invocacaoAgente.contarVivas(m.id, "s.impl")).toBe(1);
    expect(r.invocacaoAgente.fecharPorPane(p2.id)).toBe(1);
    expect(r.invocacaoAgente.fecharPorPane(p2.id)).toBe(0);
    expect(r.invocacaoAgente.contarVivas(m.id, "s.impl")).toBe(0);
    expect(r.invocacaoAgente.listarPorMissao(m.id)).toHaveLength(3);
  });

  it("modo livre: mission_id nulo; recibo longo é cortado em 240; agente_id e hash vazios são recusados", () => {
    const { r } = novo();
    const i = r.invocacaoAgente.abrir({ agente_id: "s.a", perfil: {}, prompt_hash: "h", recibo: "x".repeat(500) });
    expect(i.mission_id).toBeNull();
    expect(i.recibo).toHaveLength(240);
    expect(() => r.invocacaoAgente.abrir({ agente_id: "", perfil: {}, prompt_hash: "h" })).toThrow(ValorInvalidoErro);
    expect(() => r.invocacaoAgente.abrir({ agente_id: "s.a", perfil: {}, prompt_hash: " " })).toThrow(ValorInvalidoErro);
    expect(() => r.invocacaoAgente.exigir("inv_nada")).toThrow(NaoEncontradoErro);
  });
});

describe("repo squad-execucao", () => {
  it("cria, lista por workspace (mais novas primeiro, com cursor) e traz o estado da Missão", () => {
    const { r, ws } = novo();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const m = r.mission.criar({ workspace_id: ws.id, ...base });
      const e = r.squadExecucao.criar({ squad_slug: "s", squad_hash: H, workspace_id: ws.id, mission_id: m.id, objetivo: `o${i}`, plano_antes: i % 2 === 0, nivel_rigidez: 2 });
      ids.push(e.id);
      expect(e.id).toMatch(/^sqx_/);
    }
    const p1 = r.squadExecucao.listarPorWorkspace(ws.id, { limite: 2 });
    expect(p1.itens.map((x) => x.objetivo)).toEqual(["o4", "o3"]);
    expect(p1.itens[0]).toMatchObject({ plano_antes: true, missao_estado: "intake", nivel_rigidez: 2 });
    const p2 = r.squadExecucao.listarPorWorkspace(ws.id, { limite: 2, depois: p1.proximo as string });
    expect(p2.itens.map((x) => x.objetivo)).toEqual(["o2", "o1"]);
    expect(r.squadExecucao.porMissao(r.squadExecucao.exigir(ids[0] as string).mission_id as string)?.objetivo).toBe("o0");
    expect(r.squadExecucao.listarPorWorkspace("ws_outro").itens).toEqual([]);
  });

  it("vincula a Missão depois; recusa objetivo vazio/grande, hash ruim, workspace inexistente e 2ª execução na mesma Missão", () => {
    const { r, ws } = novo();
    const e = r.squadExecucao.criar({ squad_slug: "s", squad_hash: H, workspace_id: ws.id, objetivo: "faça", plano_antes: true });
    expect(e.mission_id).toBeNull();
    expect(e.missao_estado).toBeNull();
    const m = r.mission.criar({ workspace_id: ws.id, ...base });
    expect(r.squadExecucao.vincularMissao(e.id, m.id)).toMatchObject({ mission_id: m.id, missao_estado: "intake" });
    const e2 = r.squadExecucao.criar({ squad_slug: "s", squad_hash: H, workspace_id: ws.id, objetivo: "outra", plano_antes: false });
    expect(() => r.squadExecucao.vincularMissao(e2.id, m.id)).toThrow(/UNIQUE/);
    const mk = (extra: object) => () => r.squadExecucao.criar({ squad_slug: "s", squad_hash: H, workspace_id: ws.id, objetivo: "o", plano_antes: true, ...extra });
    expect(mk({ objetivo: "  " })).toThrow(ValorInvalidoErro);
    expect(mk({ objetivo: "x".repeat(4001) })).toThrow(ValorInvalidoErro);
    expect(mk({ squad_hash: "abc" })).toThrow(ValorInvalidoErro);
    expect(mk({ nivel_rigidez: 9 })).toThrow(ValorInvalidoErro);
    expect(mk({ workspace_id: "ws_nada" })).toThrow(NaoEncontradoErro);
    expect(r.squadExecucao.criar({ squad_slug: "s", squad_hash: H, workspace_id: ws.id, objetivo: "x".repeat(4000), plano_antes: true }).objetivo).toHaveLength(4000);
  });
});
