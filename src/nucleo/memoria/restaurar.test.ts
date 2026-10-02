import { afterEach, describe, expect, it } from "vitest";
import type { Banco } from "../banco";
import { novoBancoMemoria, semearMissao, semearPane, semearWorkspace, TS } from "../../../tests/fixtures/memoria/banco";
import { resolverContextoDoPane } from "./contexto";
import { criarEscritor } from "./escrita";
import { criarRestaurador, montarBriefDoPane, type AvisoMemoria, type PortasRestaurar } from "./restaurar";
import { criarRepoMemoria } from "./repo";
import { envelope, TAG_ENVELOPE } from "./sanear-brief";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const conta = (s: string, sub: string): number => s.split(sub).length - 1;

function mundo(op: { modo?: "agentico" | "squad" | "livre" } = {}) {
  const b = novoBancoMemoria();
  abertos.push(b);
  const ws = semearWorkspace(b);
  const mis = op.modo === "livre" ? null : semearMissao(b, "M1", ws, op.modo ?? "agentico", op.modo === "squad" ? "sq" : undefined);
  semearPane(b, { id: "P1", ws, mission: mis, papel: "piloto", display: 7, estado: "pronto" });
  const e = criarEscritor({ banco: b });
  const ctx = (): ReturnType<typeof resolverContextoDoPane> => resolverContextoDoPane(b, "P1");
  e.gravar({ ctx: ctx(), tipo: "checkpoint", conteudo: "Parei na T-08.14", origem: "agente" });
  e.gravar({ ctx: ctx(), tipo: "decisao", conteudo: "Lock por Pane", origem: "agente", importancia: 4 });
  e.gravar({ ctx: ctx(), tipo: "decisao", conteudo: "Índice único parcial", origem: "agente" });
  b.executar("UPDATE pane SET estado='encerrado', encerrado_motivo='usuario' WHERE id='P1'");
  const avisos: AvisoMemoria[] = [];
  const abertosPrompts: Array<{ contexto: { brief: string | null }; prompt_inicial: string | null; modo: string }> = [];
  let n = 100;
  const portas = (extra: Partial<PortasRestaurar> = {}): PortasRestaurar => ({
    banco: b,
    podeRetomar: () => false,
    aviso: (a) => void avisos.push(a),
    async respawn(paneId, o) {
      await new Promise((r) => setTimeout(r, 5)); // janela real para corrida
      abertosPrompts.push(o);
      const id = `F${++n}`;
      semearPane(b, { id, ws, mission: mis, papel: "piloto", respawn_de: paneId });
      b.executar("INSERT INTO sessao (id,pane_id,criado_em,atualizado_em) VALUES (?,?,?,?)", [`ses_${id}`, id, TS, TS]);
      return { pane_id: id, sessao_id: `ses_${id}` };
    },
    ...extra,
  });
  return { b, ws, portas, avisos, abertosPrompts, vivos: () => b.consultar("SELECT id FROM pane WHERE respawn_de='P1' AND estado<>'encerrado'").length, todos: () => b.consultar("SELECT id FROM pane WHERE respawn_de='P1'").length };
}

describe("restaurarPane (T-08.14)", () => {
  it("AC-08.01: restore abre 1 Pane com 1 prompt e 1 envelope com checkpoint, decisões e eventos; brief velho não duplica", async () => {
    const m = mundo();
    const velho = envelope({ display_id: 7, geradaEm: "2026-09-01T00:00:00Z", corpo: "- brief VELHO", ponteiroMemox: true });
    const r = await criarRestaurador(m.portas({ promptAnterior: () => `Continue a tarefa.\n\n${velho}` })).restaurarPane("P1", "auto");
    expect(r).toMatchObject({ modo: "brief", brief_injetado: true, truncado: false, ja_existia: false });
    expect(m.abertosPrompts).toHaveLength(1);
    const o = m.abertosPrompts[0]!;
    expect(o.contexto.brief).toContain("Parei na T-08.14");
    expect(o.contexto.brief).toContain("Lock por Pane");
    expect(o.prompt_inicial).toContain("Continue a tarefa.");
    expect(o.prompt_inicial).not.toContain("VELHO");
    expect(conta(o.prompt_inicial as string, `<${TAG_ENVELOPE}`)).toBe(1);
    expect(conta(o.prompt_inicial as string, "Retome a partir daqui")).toBe(1);
    expect(m.vivos()).toBe(1);
  });

  it("AC-08.08 (gate): 20 chamadas concorrentes = 1 Pane; 100 repetições = 0 duplicata", async () => {
    const m = mundo();
    const rest = criarRestaurador(m.portas());
    const rs = await Promise.all(Array.from({ length: 20 }, () => rest.restaurarPane("P1")));
    expect(new Set(rs.map((r) => r.pane_id)).size).toBe(1);
    expect(m.todos()).toBe(1);
    for (let i = 0; i < 100; i++) {
      const r = await rest.restaurarPane("P1");
      expect(r.ja_existia).toBe(true);
    }
    expect(m.todos()).toBe(1);
  });

  it("restauradores independentes (sem lock compartilhado) em corrida: o índice único do banco impede o 2º filho", async () => {
    const m = mundo();
    const a = criarRestaurador(m.portas());
    const b2 = criarRestaurador(m.portas());
    const rs = await Promise.allSettled([a.restaurarPane("P1"), b2.restaurarPane("P1")]);
    // um deles pode ter o respawn recusado pelo índice único: o resultado é o filho vivo, nunca um erro nem duplicata
    for (const r of rs) {
      if (r.status === "rejected") throw r.reason;
    }
    expect(m.vivos()).toBe(1);
    const ids = rs.map((r) => (r as PromiseFulfilledResult<{ pane_id: string }>).value.pane_id);
    expect(new Set(ids).size).toBe(1);
  });

  it("modo retomada (conversa nativa) NÃO injeta brief; 'brief' explícito força o brief", async () => {
    const m = mundo();
    const rest = criarRestaurador(m.portas({ podeRetomar: () => true }));
    const r = await rest.restaurarPane("P1", "auto");
    expect(r).toMatchObject({ modo: "retomada", brief_injetado: false });
    expect(m.abertosPrompts[0]?.contexto.brief).toBeNull();
    const m2 = mundo();
    const r2 = await criarRestaurador(m2.portas({ podeRetomar: () => true })).restaurarPane("P1", "brief");
    expect(r2).toMatchObject({ modo: "brief", brief_injetado: true });
  });

  it("AC-08.06: memória desligada → sem brief e nada novo gravado", async () => {
    const m = mundo();
    criarRepoMemoria(m.b).gravarConfig("ws_1", { ativa: false }, TS);
    const antes = m.b.consultar("SELECT 1 FROM memoria_entrada").length;
    const r = await criarRestaurador(m.portas()).restaurarPane("P1");
    expect(r).toMatchObject({ modo: "sem_memoria", brief_injetado: false });
    expect(m.abertosPrompts[0]).toEqual({ contexto: { brief: null }, prompt_inicial: null, modo: "sem_memoria" });
    expect(m.b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(antes);
  });

  it("falha ao montar o brief: abre sem brief e avisa (não bloqueia o restore)", async () => {
    const m = mundo();
    const r = await criarRestaurador(m.portas({ memoxInstalado: () => { throw new Error("falha no memox"); } })).restaurarPane("P1");
    expect(r).toMatchObject({ modo: "brief", brief_injetado: false });
    expect(m.avisos).toEqual([{ pane_id: "P1", codigo: "brief_falhou", mensagem: expect.any(String) }]);
    expect(m.vivos()).toBe(1);
  });

  it("Pane vivo não se restaura; inexistente é erro nominal; erro do respawn propaga e libera o lock", async () => {
    const m = mundo();
    m.b.executar("UPDATE pane SET estado='pronto' WHERE id='P1'");
    const rest = criarRestaurador(m.portas());
    await expect(rest.restaurarPane("P1")).rejects.toThrow(/ainda está em uso/);
    await expect(rest.restaurarPane("nada")).rejects.toThrow(/não encontrado/);
    m.b.executar("UPDATE pane SET estado='encerrado' WHERE id='P1'");
    let falhar = true;
    const r2 = criarRestaurador(m.portas({ respawn: async () => { if (falhar) throw new Error("spawn falhou"); return { pane_id: "X", sessao_id: "S" }; } }));
    await expect(r2.restaurarPane("P1")).rejects.toThrow("spawn falhou");
    falhar = false;
    await expect(r2.restaurarPane("P1")).resolves.toMatchObject({ pane_id: "X" });
  });

  it("squad e livre também restauram com brief (P-21/P-24); a prévia é exatamente o que o restore injeta", async () => {
    for (const modo of ["squad", "livre"] as const) {
      const m = mundo({ modo });
      const previa = montarBriefDoPane({ banco: m.b, agora: () => new Date("2026-10-01T10:00:00.000Z") }, "P1");
      expect(previa.modo).toBe(modo === "squad" ? "squad" : "solo");
      const rest = criarRestaurador(m.portas({ agora: () => new Date("2026-10-01T10:00:00.000Z") }));
      await rest.restaurarPane("P1");
      expect(m.abertosPrompts[0]?.contexto.brief).toBe(previa.markdown);
    }
  });

  it("P-36: clique → Pane (sem a CLI) ≤ 300 ms com 1 000 entradas na linhagem", async () => {
    const m = mundo();
    const e = criarEscritor({ banco: m.b });
    const ctx = resolverContextoDoPane(m.b, "P1");
    m.b.transacao(() => { for (let i = 0; i < 400; i++) e.gravar({ ctx, tipo: i % 3 === 0 ? "decisao" : "fato", conteudo: `entrada ${i} ${"y".repeat(100)}`, origem: "coletor", fonte: "sistema" }); });
    const t0 = performance.now();
    await criarRestaurador(m.portas({ respawn: async (id) => { semearPane(m.b, { id: "F900", ws: "ws_1", mission: "M1", respawn_de: id }); return { pane_id: "F900", sessao_id: "s" }; } })).restaurarPane("P1");
    expect(performance.now() - t0).toBeLessThan(300);
  });
});
