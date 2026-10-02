import { describe, expect, it } from "vitest";
import type { DetalheMissao, Mission, Pane } from "../../../compartilhado/dominio";
import { formatarCusto, mapaDeDetalhes, particionarMissao, rotuloMissao, type InfoPane } from "./missao";
import type { NoPainel } from "./layout";

const T = (sessao_id: string): NoPainel => ({ tipo: "terminal", sessao_id });
const D = (primeiro: NoPainel, segundo: NoPainel): NoPainel => ({ tipo: "divisao", orientacao: "vertical", primeiro, segundo });
const info = (p: Partial<InfoPane> & { sessaoId: string }): InfoPane => ({ displayId: 1, papel: "executor", ehPiloto: false, missaoId: "m1", missaoTitulo: "Missão X", ...p });

describe("particionarMissao", () => {
  it("separa o piloto (fixo à esquerda) dos workers, mantendo a árvore dos workers", () => {
    const mapa = { a: info({ sessaoId: "a", ehPiloto: true, papel: "piloto" }), b: info({ sessaoId: "b" }), c: info({ sessaoId: "c" }) };
    const r = particionarMissao(D(T("b"), D(T("a"), T("c"))), mapa);
    expect(r?.piloto).toBe("a");
    expect(r?.workers).toEqual(D(T("b"), T("c")));
  });
  it("piloto sozinho: sem workers (espaço reservado pela UI)", () => {
    const r = particionarMissao(T("a"), { a: info({ sessaoId: "a", ehPiloto: true }) });
    expect(r).toEqual({ piloto: "a", workers: null });
  });
  it("aba sem piloto de missão não vira layout de missão", () => {
    expect(particionarMissao(D(T("a"), T("b")), { a: info({ sessaoId: "a" }) })).toBeNull();
    expect(particionarMissao(D(T("a"), T("b")), {})).toBeNull();
  });
});

describe("rótulo e custo", () => {
  it("rótulo #id · CLI · papel · missão", () => {
    expect(rotuloMissao(info({ sessaoId: "a", displayId: 325, papel: "piloto", ehPiloto: true }), "Claude Code")).toBe("#325 · Claude Code · piloto · Missão X");
  });
  it("custo desconhecido é texto, nunca 0", () => {
    expect(formatarCusto(info({ sessaoId: "a" }))).toBe("custo desconhecido");
    expect(formatarCusto(info({ sessaoId: "a", tokens: null, custo: null }))).toBe("custo desconhecido");
    expect(formatarCusto(info({ sessaoId: "a", tokens: 12_300 }))).toMatch(/12,3 mil tokens|12\.3k|12,3k/);
    expect(formatarCusto(info({ sessaoId: "a", custo: 0.5 }))).toContain("0,50");
  });
});

describe("mapaDeDetalhes", () => {
  const missao = (id: string, modo: Mission["modo"]): Mission => ({ id, criado_em: "", atualizado_em: "", workspace_id: "w", modo, origem: "livre", trabalho_id: null, titulo: `T ${id}`, estado: "executando", worktree: null, branch: null, piloto_pane_id: "p1", concluida_em: null });
  const pane = (id: string, mission_id: string | null, extra: Partial<Pane> = {}): Pane => ({ id, criado_em: "", atualizado_em: "", mission_id, workspace_id: "w", display_id: 7, tipo: "cli", cli: "claude", executavel_id: null, conta_id: null, modelo: null, esforco: null, papel: "executor", eh_piloto: false, estado: "pronto", sessao_pty_id: `s-${id}`, respawn_de: null, cwd: null, encerrado_motivo: null, ...extra });
  const det = (m: Mission, panes: Pane[]): DetalheMissao => ({ mission: m, panes, tasks: [], handoffs: [] });
  it("D-520: worker com handoff `falhou` leva `handoffFalhou` (a grade o mostra como Falhou mesmo com a CLI saindo com 0)", () => {
    const mapa = mapaDeDetalhes({
      m1: { ...det(missao("m1", "agentico"), [pane("p2", "m1"), pane("p3", "m1")]), handoffs: [
        { id: "h1", task_id: "t", de_pane_id: "p2", para_pane_id: "p1", resumo: "", relatorio_path: null, status: "falhou", criado_em: "", atualizado_em: "" },
        { id: "h2", task_id: "t", de_pane_id: "p3", para_pane_id: "p1", resumo: "", relatorio_path: null, status: "ok", criado_em: "", atualizado_em: "" },
      ] },
    });
    expect(mapa["s-p2"]?.handoffFalhou).toBe(true);
    expect(mapa["s-p3"]?.handoffFalhou).toBeUndefined();
  });
  it("só squad/agêntico entram; panes sem sessão ficam de fora; respawn do piloto marca o aviso", () => {
    const mapa = mapaDeDetalhes({
      m1: det(missao("m1", "agentico"), [pane("p1", "m1", { eh_piloto: true, papel: "piloto", respawn_de: "p0" }), pane("p2", "m1"), pane("p3", "m1", { sessao_pty_id: null })]),
      m2: det(missao("m2", "livre"), [pane("p4", "m2")]),
      m3: null,
    });
    expect(Object.keys(mapa).sort()).toEqual(["s-p1", "s-p2"]);
    expect(mapa["s-p1"]).toMatchObject({ ehPiloto: true, missaoTitulo: "T m1", reiniciadoSemConteudo: true, displayId: 7 });
    expect(mapa["s-p2"]?.reiniciadoSemConteudo).toBe(false);
  });
});

describe("Missão avulsa (painel que orquestra)", () => {
  const avulso = (extra: Partial<InfoPane>) => info({ sessaoId: "a", avulsa: true, ...extra });
  it("não particiona em 'piloto à esquerda': a grade equilibrada manda", () => {
    const mapa = { a: avulso({ ehPiloto: true, papel: "piloto" }), b: avulso({ sessaoId: "b" }) };
    expect(particionarMissao(D(T("a"), T("b")), mapa)).toBeNull();
  });
  it("rótulo curto: orquestrando no pedinte e a tarefa no worker", () => {
    expect(rotuloMissao(avulso({ displayId: 4, ehPiloto: true, papel: "piloto" }), "Codex")).toBe("#4 · Codex · orquestrando");
    expect(rotuloMissao(avulso({ displayId: 5, tarefa: "Notícias de IA na Ásia" }), "Codex")).toBe("#5 · Codex · Notícias de IA na Ásia");
    expect(rotuloMissao(avulso({ displayId: 6 }), "Codex")).toBe("#6 · Codex · executor");
  });
  it("mapaDeDetalhes marca a Missão avulsa e leva o título da task do pane", () => {
    const mission = { id: "m9", workspace_id: "w", modo: "agentico", origem: "livre", titulo: "Missão avulsa · #2", estado: "executando", worktree: null } as unknown as Mission;
    const panes = [{ id: "p1", mission_id: "m9", display_id: 2, cli: "codex", papel: "piloto", eh_piloto: true, sessao_pty_id: "s1", respawn_de: null }, { id: "p2", mission_id: "m9", display_id: 3, cli: "codex", papel: "executor", eh_piloto: false, sessao_pty_id: "s2", respawn_de: null }] as unknown as Pane[];
    const d = { mission, panes, tasks: [{ pane_id: "p2", titulo: "Buscar notícias" }], handoffs: [] } as unknown as DetalheMissao;
    const mapa = mapaDeDetalhes({ m9: d });
    expect(mapa["s1"]).toMatchObject({ avulsa: true, ehPiloto: true });
    expect(mapa["s2"]).toMatchObject({ avulsa: true, tarefa: "Buscar notícias" });
  });
});
