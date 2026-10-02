import { afterEach, describe, expect, it } from "vitest";
import type { Banco } from "../banco";
import { novoBancoMemoria, semearMissao, semearPane, semearWorkspace, TS } from "../../../tests/fixtures/memoria/banco";
import { criarCiclo } from "./ciclo";
import { ligarColetor, type BarramentoColetor } from "./coletor";
import { criarRepoMemoria } from "./repo";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

function barramentoFalso() {
  const m = new Map<string, Array<(p: unknown) => void>>();
  const b: BarramentoColetor = {
    assinar: (tipo, o) => {
      const l = m.get(tipo) ?? [];
      l.push(o as (p: unknown) => void);
      m.set(tipo, l);
      return () => void m.set(tipo, (m.get(tipo) ?? []).filter((x) => x !== o));
    },
  };
  return { b, emitir: (tipo: string, p: unknown) => (m.get(tipo) ?? []).forEach((o) => o(p)), ouvintes: (t: string) => (m.get(t) ?? []).length };
}

function mundo(modo: "agentico" | "squad" | "livre" = "agentico") {
  const b = novoBancoMemoria();
  abertos.push(b);
  const ws = semearWorkspace(b);
  const mis = modo === "livre" ? null : semearMissao(b, "M1", ws, modo, modo === "squad" ? "sq" : undefined);
  semearPane(b, { id: "P1", ws, mission: mis, papel: "piloto", display: 3 });
  const bar = barramentoFalso();
  const filas: Array<() => void> = [];
  const col = ligarColetor({ banco: b, barramento: bar.b, agendar: (fn) => void filas.push(fn) });
  const tique = (): void => {
    for (let i = 0; i < 1000 && filas.length > 0; i++) filas.splice(0).forEach((f) => f());
  };
  return { b, ws, bar, col, tique, repo: criarRepoMemoria(b) };
}
const semHandoff = (m: ReturnType<typeof mundo>, status = "ok"): void => {
  m.b.executar("INSERT INTO task (id,mission_id,task_ref,titulo,papel,estado,pane_id,criado_em,atualizado_em) VALUES ('task_1','M1','T-1','t','executor','entregue','P1',?,?)", [TS, TS]);
  m.b.executar("INSERT INTO handoff (id,task_id,de_pane_id,resumo,status,criado_em,atualizado_em) VALUES ('hand_1','task_1','P1','implementei a escrita',?,?,?)", [status, TS, TS]);
};

describe("coletor (T-08.08)", () => {
  it("handoff_submit gera entrada handoff de Missão com 'ref · status · resumo' (AC-08.01 base)", () => {
    const m = mundo();
    semHandoff(m);
    m.bar.emitir("handoff.submitted", { handoff_id: "hand_1", task_id: "task_1", pane_id: "P1", status: "ok" });
    expect(m.b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(0); // ainda na fila do tique
    m.tique();
    const l = m.b.consultarUm<{ tipo: string; escopo: string; conteudo: string; importancia: number; fonte: string }>("SELECT tipo, escopo, conteudo, importancia, fonte FROM memoria_entrada");
    expect(l).toEqual({ tipo: "handoff", escopo: "missao", conteudo: "T-1 · ok · implementei a escrita", importancia: 3, fonte: "sistema" });
  });
  it("handoff com status ≠ ok sobe a importância para 4; pane.closed vira evento do Pane; task validada vira evento da Missão", () => {
    const m = mundo();
    semHandoff(m, "falhou");
    m.bar.emitir("handoff.submitted", { handoff_id: "hand_1", task_id: "task_1", pane_id: "P1", status: "falhou" });
    m.bar.emitir("pane.closed", { pane_id: "P1", reason: "usuario" });
    m.bar.emitir("task.updated", { task_id: "task_1", estado: "validada" });
    m.bar.emitir("task.updated", { task_id: "task_1", estado: "reivindicada" }); // ignorado
    m.tique();
    const ls = m.b.consultar<{ tipo: string; escopo: string; conteudo: string; importancia: number }>("SELECT tipo, escopo, conteudo, importancia FROM memoria_entrada ORDER BY conteudo");
    expect(ls.find((l) => l.tipo === "handoff")?.importancia).toBe(4);
    expect(ls.find((l) => l.conteudo.startsWith("Painel #3 encerrado (usuario)"))).toMatchObject({ tipo: "evento", escopo: "pane", importancia: 2 });
    expect(ls.find((l) => l.conteudo === "Task T-1 validada")).toMatchObject({ escopo: "missao" });
    expect(ls).toHaveLength(3);
  });
  it("modo off (workspace/global/Missão desligados) e shell: a tabela não cresce", () => {
    const m = mundo();
    m.repo.gravarConfig("ws_1", { ativa: false }, TS);
    m.bar.emitir("pane.closed", { pane_id: "P1", reason: "x" });
    m.tique();
    expect(m.b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(0);
    m.repo.gravarConfig("ws_1", { ativa: true }, TS);
    m.repo.definirGlobalAtiva(false, TS);
    m.bar.emitir("pane.closed", { pane_id: "P1", reason: "x" });
    m.tique();
    expect(m.b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(0);
    m.repo.definirGlobalAtiva(true, TS);
    m.repo.definirMissaoAtiva("M1", false, TS);
    m.bar.emitir("pane.closed", { pane_id: "P1", reason: "x" });
    m.tique();
    expect(m.b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(0);
  });
  it("squad coleta (P-24, memória própria); livre coleta como solo (P-21)", () => {
    const s = mundo("squad");
    s.bar.emitir("pane.closed", { pane_id: "P1", reason: "x" });
    s.tique();
    expect(s.b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(1);
    const l = mundo("livre");
    l.bar.emitir("pane.closed", { pane_id: "P1", reason: "x" });
    l.tique();
    expect(l.b.consultar("SELECT escopo FROM memoria_entrada")).toEqual([{ escopo: "pane" }]);
  });
  it("method.changed: uma linha por (trabalho, task, tipo), deduplicada; tipo desconhecido ignorado", () => {
    const m = mundo();
    m.b.executar("UPDATE mission SET trabalho_id = 'sprint-x' WHERE id = 'M1'");
    for (let i = 0; i < 3; i++) m.bar.emitir("method.changed", { tipo: "task_concluida", trabalho_id: "sprint-x", task: "T-02.01" });
    m.bar.emitir("method.changed", { tipo: "outro", trabalho_id: "sprint-x" });
    m.tique();
    expect(m.b.consultar<{ conteudo: string }>("SELECT conteudo FROM memoria_entrada")).toEqual([{ conteudo: "Método: task T-02.01 concluída (sprint-x)" }]);
  });
  it("rajada de 500 eventos = poucas transações (uma por fatia de ~15 ms), nenhuma fatia longa; payload inválido não derruba nada", () => {
    const m = mundo();
    for (let i = 0; i < 500; i++) m.bar.emitir("pane.closed", { pane_id: "P1", reason: `r${i}` });
    m.bar.emitir("pane.closed", null);
    m.bar.emitir("handoff.submitted", { handoff_id: 5 });
    m.tique();
    const st = m.col.estatisticas();
    expect(st.eventos).toBe(500);
    expect(st.transacoes).toBeLessThan(60); // e não 500: escritas agrupadas por fatia
    expect(st.pendentes).toBe(0);
  });
  it("mission.closed aciona o ciclo (destilação) depois de entregar a fila; parar() cancela as assinaturas", () => {
    const b = novoBancoMemoria();
    abertos.push(b);
    const ws = semearWorkspace(b);
    semearMissao(b, "M1", ws);
    semearPane(b, { id: "P1", ws, mission: "M1", papel: "piloto" });
    const bar = barramentoFalso();
    const filas: Array<() => void> = [];
    const ciclo = criarCiclo({ banco: b });
    const col = ligarColetor({ banco: b, barramento: bar.b, ciclo, agendar: (fn) => void filas.push(fn) });
    b.executar("INSERT INTO task (id,mission_id,task_ref,titulo,papel,estado,criado_em,atualizado_em) VALUES ('task_1','M1','T-1','t','executor','validada',?,?)", [TS, TS]);
    b.executar("INSERT INTO handoff (id,task_id,de_pane_id,resumo,status,criado_em,atualizado_em) VALUES ('hand_1','task_1','P1','fiz tudo',?,?,?)", ["ok", TS, TS]);
    bar.emitir("handoff.submitted", { handoff_id: "hand_1", task_id: "task_1", pane_id: "P1", status: "ok" });
    bar.emitir("mission.closed", { mission_id: "M1" });
    expect(b.consultar("SELECT 1 FROM memoria_entrada WHERE tipo = 'aprendizado' AND fonte = 'sistema' AND anel = 1")).toHaveLength(1); // aprendizado de sistema (D-50)
    expect(Number(b.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_entrada WHERE anel = 2")?.n)).toBe(1); // destilado para o anel 2
    col.parar();
    expect(bar.ouvintes("pane.closed")).toBe(0);
    bar.emitir("pane.closed", { pane_id: "P1", reason: "x" });
    filas.splice(0).forEach((f) => f());
    expect(b.consultar("SELECT 1 FROM memoria_entrada WHERE conteudo LIKE 'Painel%'")).toHaveLength(0);
  });
});
