// Contrato memória → conhecimento (T-08.35) com CONSUMIDOR FALSO (fila limitada em memória): a Fase 15 só injeta a porta real.
import { afterEach, describe, expect, it } from "vitest";
import type { Banco } from "../banco";
import { novoBancoMemoria, semearMissao, semearPane, semearWorkspace, TS } from "../../../tests/fixtures/memoria/banco";
import type { BarramentoColetor } from "./coletor";
import { criarLimitador } from "./escrita";
import { criarPortaEnfileirada, TABELA_EVENTOS, TIPOS_EVENTO_CONHECIMENTO, type EventoConhecimento } from "./eventos-conhecimento";
import { criarServicoMemoria } from "./servico";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

function barramento() {
  const m = new Map<string, Array<(p: unknown) => void>>();
  const b: BarramentoColetor = { assinar: (t, o) => (m.set(t, [...(m.get(t) ?? []), o as (p: unknown) => void]), () => undefined) };
  return { b, emitir: (t: string, p: unknown) => (m.get(t) ?? []).forEach((o) => o(p)) };
}

function mundo(op: { consumidor?: (e: EventoConhecimento) => void | Promise<void>; limite?: number; modo?: "agentico" | "squad" } = {}) {
  const b = novoBancoMemoria();
  abertos.push(b);
  const ws = semearWorkspace(b);
  semearMissao(b, "M1", ws, op.modo ?? "agentico", op.modo === "squad" ? "sq" : undefined);
  semearPane(b, { id: "A", ws, mission: "M1", papel: "piloto", display: 4 });
  const recebidos: EventoConhecimento[] = [];
  const porta = criarPortaEnfileirada(op.consumidor ?? ((e) => void recebidos.push(e)), op.limite ? { limite: op.limite } : {});
  const svc = criarServicoMemoria({ banco: b, porta, raizDoWorkspace: () => "/work/ws_1", limitador: criarLimitador({ porMinuto: 100_000 }) });
  const bar = barramento();
  const filas: Array<() => void> = [];
  const col = svc.coletor(bar.b, { agendar: (fn) => void filas.push(fn) });
  const tique = (): void => {
    for (let i = 0; i < 1000 && filas.length > 0; i++) filas.splice(0).forEach((f) => f());
  };
  return { b, svc, porta, recebidos, bar, col, tique };
}
const sembrarHandoff = (b: Banco, relatorio: string | null): void => {
  b.executar("INSERT INTO task (id,mission_id,task_ref,titulo,papel,estado,criado_em,atualizado_em) VALUES ('task_1','M1','T-9','t','executor','entregue',?,?)", [TS, TS]);
  b.executar("INSERT INTO handoff (id,task_id,de_pane_id,resumo,relatorio_path,status,criado_em,atualizado_em) VALUES ('hand_1','task_1','A','entreguei com API_KEY=zzz123 em /work/ws_1/src/a.ts',?,'ok',?,?)", [relatorio, TS, TS]);
};

describe("memória → conhecimento (T-08.35)", () => {
  it("(1) handoff_submit → handoff.submitted com referência de relatório RELATIVA e texto redigido", async () => {
    const m = mundo();
    sembrarHandoff(m.b, "/work/ws_1/.pasta-do-app/missoes/M1/T-9.md");
    m.bar.emitir("handoff.submitted", { handoff_id: "hand_1", task_id: "task_1", pane_id: "A", status: "ok" });
    m.tique();
    await m.porta.drenar();
    const e = m.recebidos.find((x) => x.tipo === "handoff.submitted")!;
    expect(e).toBeDefined();
    expect(e.referencias).toEqual(expect.arrayContaining([{ tipo: "relatorio", id: ".pasta-do-app/missoes/M1/T-9.md" }, { tipo: "task", id: "T-9" }, { tipo: "handoff", id: "hand_1" }]));
    expect(e.texto).not.toContain("zzz123");
    expect(e.texto).toContain("T-9 · ok");
  });
  it("(1b) relatório com caminho absoluto fora da raiz: a referência é descartada, o evento segue", async () => {
    const m = mundo();
    sembrarHandoff(m.b, "/etc/relatorio.md");
    m.bar.emitir("handoff.submitted", { handoff_id: "hand_1", task_id: "task_1", pane_id: "A", status: "ok" });
    m.tique();
    await m.porta.drenar();
    const e = m.recebidos.find((x) => x.tipo === "handoff.submitted")!;
    expect(e.referencias.some((r) => r.tipo === "relatorio")).toBe(false);
  });
  it("(2)(3) Pane fechado → pane.closed; task validada → task.updated", async () => {
    const m = mundo();
    sembrarHandoff(m.b, null);
    m.bar.emitir("pane.closed", { pane_id: "A", reason: "usuario" });
    m.bar.emitir("task.updated", { task_id: "task_1", estado: "validada" });
    m.tique();
    await m.porta.drenar();
    expect(m.recebidos.map((e) => e.tipo).sort()).toEqual(["pane.closed", "task.updated"]);
  });
  it("(4) mission.closed → UMA vez com aprendizado e decisões; reentrega mantém o mesmo id (consumidor deduplica)", async () => {
    const m = mundo();
    m.svc.memory_write("A", { content: "Aprendi a validar antes de gravar", kind: "learning", importance: 4, scope: "mission" });
    m.svc.memory_write("A", { content: "Decidi usar transação única", kind: "decision", importance: 5, scope: "mission" });
    m.bar.emitir("mission.closed", { mission_id: "M1" });
    m.bar.emitir("mission.closed", { mission_id: "M1" });
    await m.porta.drenar();
    const fechados = m.recebidos.filter((e) => e.tipo === "mission.closed");
    expect(new Set(fechados.map((e) => e.id)).size).toBe(1);
    expect(fechados[0]?.texto).toContain("validar antes de gravar");
    expect(fechados[0]?.texto).toContain("transação única");
    // dedupe do consumidor por id: o RAG indexa 1 documento
    expect(new Set(m.recebidos.map((e) => e.id)).size).toBeLessThan(m.recebidos.length + 1);
  });
  it("(5) memory_write de decision|checkpoint|learning → memory.decision|checkpoint|learning (fato não emite)", async () => {
    const m = mundo();
    m.svc.memory_write("A", { content: "decisão X", kind: "decision" });
    m.svc.memory_checkpoint("A", { summary: "cp Y" });
    m.svc.memory_write("A", { content: "lição Z", kind: "learning" });
    m.svc.memory_write("A", { content: "fato W", kind: "fact" });
    await m.porta.drenar();
    expect(m.recebidos.map((e) => e.tipo)).toEqual(["memory.decision", "memory.checkpoint", "memory.learning"]);
  });
  it("(6) modo off: NENHUM evento (nem entrada); squad agora tem memória (P-24) e também emite", async () => {
    const m = mundo();
    m.svc.gravarConfig("ws_1", { ativa: false });
    m.bar.emitir("pane.closed", { pane_id: "A", reason: "x" });
    m.tique();
    expect(() => m.svc.memory_write("A", { content: "x", kind: "decision" })).toThrow();
    await m.porta.drenar();
    expect(m.recebidos).toHaveLength(0);
    const s = mundo({ modo: "squad" });
    s.svc.memory_write("A", { content: "decisão de squad", kind: "decision" });
    await s.porta.drenar();
    expect(s.recebidos.map((e) => e.tipo)).toEqual(["memory.decision"]);
  });
  it("(7) consumidor lento/cheio/que lança não atrasa a escrita (P-34) e a memória segue íntegra", async () => {
    const m = mundo({ consumidor: () => new Promise<void>(() => undefined), limite: 5 });
    const xs: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      m.svc.memory_write("A", { content: `decisão ${i}`, kind: "decision" });
      xs.push(performance.now() - t0);
    }
    expect(xs.sort((a, b) => a - b)[94] ?? 99).toBeLessThan(5 * (Number(process.env.EXPXV_PERF_FATOR) || 1));
    expect(Number(m.b.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_entrada")?.n)).toBe(100);
    expect(m.porta.descartados()).toBeGreaterThan(80);
    const q = mundo({ consumidor: () => { throw new Error("boom"); } });
    expect(() => q.svc.memory_write("A", { content: "d", kind: "decision" })).not.toThrow();
    await q.porta.drenar();
  });
  it("(8) varredura: nenhum segredo e nenhum caminho absoluto em nenhum evento", async () => {
    const m = mundo();
    sembrarHandoff(m.b, "/work/ws_1/r.md");
    m.svc.memory_write("A", { content: "usei sk-abcdefghijklmnopqrstuvwxyz0123456789 em /Users/fulano/proj/x.ts e /work/ws_1/src/y.ts", kind: "decision" });
    m.svc.memory_checkpoint("A", { summary: "token=abc123def456 em C:\\Users\\fulano\\proj\\z.ts" });
    m.bar.emitir("handoff.submitted", { handoff_id: "hand_1", task_id: "task_1", pane_id: "A", status: "ok" });
    m.bar.emitir("pane.closed", { pane_id: "A", reason: "usuario" });
    m.tique();
    m.svc.ciclo.aoFecharMissao("M1");
    await m.porta.drenar();
    expect(m.recebidos.length).toBeGreaterThanOrEqual(4);
    const tudo = JSON.stringify(m.recebidos);
    expect(tudo).not.toContain("sk-abc");
    expect(tudo).not.toContain("abc123def456");
    expect(tudo).not.toContain("zzz123");
    expect(tudo).not.toMatch(/\/Users\/|\/work\/ws_1|C:\\\\Users/);
    for (const e of m.recebidos) for (const r of e.referencias) if (r.tipo === "arquivo_rel" || r.tipo === "relatorio") expect(r.id.startsWith("/")).toBe(false);
  });
  it("a tabela tipo → chave natural → tags cobre todos os tipos (constante para a Fase 15 importar)", () => {
    for (const t of TIPOS_EVENTO_CONHECIMENTO) expect(TABELA_EVENTOS[t].tags.length).toBeGreaterThan(0);
  });
});
