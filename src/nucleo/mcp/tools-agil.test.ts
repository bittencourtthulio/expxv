// Tools da gestão ágil (Fase 18, T-18.37): matriz por modo/papel (opt-in do token), formato, identidade só do token, `human_only`, ≤ 4 KB e o caminho completo
// tool -> porta -> serviço -> SQLite. O agente LÊ e PROPÕE; nunca decide.
import { afterEach, describe, expect, it } from "vitest";
import { WS_A, WS_B, montarAgil, type MontagemAgil } from "../../../tests/fixtures/agil/montagem-main";
import { claimsDe, criarMundo } from "../../../tests/fixtures/mcp/dubles";
import { DEFINICOES, TOOLS_AGIL, TOOLS_AGIL_LEITURA, TOOLS_AGIL_PROPOSTA, TOOLS_MVP, ferramentasPermitidas } from "./catalogo";
import { ErroMcp } from "./erros";
import type { ClaimsDeAgil, NomeToolAgil, PortaAgilMcp } from "./portas";
import { criarEmissorDeTokens } from "./tokens";
import { IMPLEMENTACOES } from "./tools/index";

const WORKERS = ["executor", "explorador", "revisor"] as const;
const abertos: MontagemAgil[] = [];
afterEach(() => abertos.splice(0).forEach((m) => m.fechar()));

describe("matriz por modo/papel (opt-in do token)", () => {
  it("as 8 tools existem no catálogo, com definição anunciada coerente", () => {
    expect([...TOOLS_AGIL]).toEqual(["backlog_list", "backlog_get", "estimate_get", "sprint_status", "rework_list", "metrics_get", "backlog_propose", "estimate_propose"]);
    for (const t of TOOLS_AGIL) {
      expect(TOOLS_MVP).toContain(t);
      expect(DEFINICOES[t].name).toBe(t);
      expect(DEFINICOES[t].inputSchema.type).toBe("object");
    }
    expect(DEFINICOES.estimate_propose.inputSchema.required).toEqual(["item_ref", "points"]);
  });

  it("sem `agil` no token nenhuma tool ágil aparece, em nenhum modo ou papel", () => {
    for (const modo of ["livre", "squad", "agentico"] as const)
      for (const papel of ["piloto", "nenhum", ...WORKERS] as const)
        for (const t of TOOLS_AGIL) expect(ferramentasPermitidas(modo, papel), `${modo}/${papel}`).not.toContain(t);
  });

  it("com `agil`: leitura para todo papel que não seja worker; proposta só do piloto em squad/agentico; worker só entrega", () => {
    for (const modo of ["livre", "squad", "agentico"] as const) {
      for (const t of TOOLS_AGIL_LEITURA) {
        expect(ferramentasPermitidas(modo, "piloto", { agil: true })).toContain(t);
        expect(ferramentasPermitidas(modo, "nenhum", { agil: true })).toContain(t);
      }
      for (const t of TOOLS_AGIL_PROPOSTA) {
        expect(ferramentasPermitidas(modo, "piloto", { agil: true }).includes(t), `${modo} piloto ${t}`).toBe(modo !== "livre");
        expect(ferramentasPermitidas(modo, "nenhum", { agil: true })).not.toContain(t);
      }
      for (const w of WORKERS) expect(ferramentasPermitidas(modo, w, { agil: true })).toEqual(["handoff_submit"]);
    }
  });

  it("o token carrega só o que o main decidiu (agil) e `tools_allow` só restringe", () => {
    const e = criarEmissorDeTokens({});
    const base = { workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_1", role: "piloto" as const, mode: "agentico" as const };
    expect(e.verificar(e.emitir({ ...base, agil: true }))?.tools_allow).toEqual(expect.arrayContaining([...TOOLS_AGIL]));
    expect(e.verificar(e.emitir(base))?.tools_allow).not.toContain("backlog_list");
    expect(e.verificar(e.emitir({ ...base, agil: true, tools_allow: ["backlog_list"] }))?.tools_allow).toEqual(["backlog_list"]);
  });
});

// ------------------------------------------------------------------ formato e identidade (porta dublê)
function dubleDePorta(retorno: (tool: NomeToolAgil, args: Record<string, unknown>) => unknown = () => ({ ok: true })) {
  const chamadas: { tool: NomeToolAgil; claims: ClaimsDeAgil; args: Record<string, unknown> }[] = [];
  const porta: PortaAgilMcp = { chamar: async (tool, claims, args) => { chamadas.push({ tool, claims, args }); return retorno(tool, args); } };
  return { porta, chamadas };
}
async function chamar(nome: NomeToolAgil, args: unknown, porta: PortaAgilMcp | null, claims: Partial<Parameters<typeof claimsDe>[0]> = {}) {
  const m = criarMundo();
  if (porta !== null) m.deps.agil = porta;
  const c = claimsDe({ mode: "agentico", role: "piloto", mission_id: "mis_1", pane_id: "pane_do_token", workspace_id: "ws_do_token", ...claims });
  return IMPLEMENTACOES[nome](args as Record<string, unknown>, { claims: c, deps: m.deps }) as Promise<Record<string, any>>;
}
async function falha(p: Promise<unknown>): Promise<{ code: string; subcode?: string }> {
  try { await p; } catch (e) { return (e as ErroMcp).corpo(); }
  throw new Error("não falhou");
}
const bytes = (o: unknown): number => Buffer.byteLength(JSON.stringify(o), "utf8");

describe("formato e identidade", () => {
  it("a identidade vai SEMPRE do token: workspace_id/ator/origem/estado nos argumentos são descartados", async () => {
    const d = dubleDePorta();
    await chamar("backlog_propose", { title: "T", description: "d", criteria: ["a"], workspace_id: "ws_outro", ator: "humano", origem: "metodo", state: "aceita", resumo_cliente: "x", pane_id: "p" }, d.porta);
    expect(d.chamadas[0]).toMatchObject({ tool: "backlog_propose", args: { title: "T", description: "d", criteria: ["a"] }, claims: { workspace_id: "ws_do_token", pane_id: "pane_do_token", role: "piloto", mode: "agentico" } });
    expect(Object.keys(d.chamadas[0]?.args ?? {}).sort()).toEqual(["criteria", "description", "title"]);
  });

  it("backlog_list/get, estimate_get, sprint_status, rework_list e metrics_get repassam só campos conhecidos", async () => {
    const d = dubleDePorta((t) => (t === "backlog_list" ? { items: [], next: null } : t === "rework_list" ? { eventos: [], situacoes: [] } : t === "metrics_get" ? { metric: "wip", data: null } : { estimates: [], history: [], health: [] }));
    await chamar("backlog_list", { status: "done", epic_id: "epi_1", limit: 10, cursor: "20", ator: "x" }, d.porta);
    await chamar("backlog_get", { item_id: "it_1", extra: 1 }, d.porta);
    await chamar("estimate_get", { item_ref: "feat-01/T-01.01" }, d.porta);
    await chamar("sprint_status", { sprint_id: "spr_1", x: 1 }, d.porta);
    await chamar("rework_list", { sprint_id: "spr_1", limit: 5, motivo: "x" }, d.porta);
    await chamar("metrics_get", { metric: "wip", sprint_id: "spr_1" }, d.porta);
    expect(d.chamadas.map((c) => c.args)).toEqual([
      { status: "done", epic_id: "epi_1", limit: 10, cursor: "20" }, { item_id: "it_1" }, { item_ref: "feat-01/T-01.01" }, { sprint_id: "spr_1" }, { sprint_id: "spr_1", limit: 5 }, { metric: "wip", sprint_id: "spr_1" },
    ]);
  });

  it("recusa formato inválido com invalid_argument e nunca chama a porta", async () => {
    const d = dubleDePorta();
    for (const [t, a] of [
      ["backlog_list", { status: "feito" }], ["backlog_list", { limit: 101 }], ["backlog_list", { limit: 0 }], ["backlog_get", {}], ["backlog_get", { item_id: "a\u0000b" }],
      ["backlog_propose", {}], ["backlog_propose", { title: "x".repeat(301) }], ["backlog_propose", { title: "t", criteria: Array(11).fill("a") }], ["backlog_propose", { title: "t", criteria: [1] }],
      ["estimate_propose", { item_ref: "i" }], ["estimate_propose", { item_ref: "i", points: -3 }], ["estimate_propose", { item_ref: "i", points: "5" }], ["estimate_propose", { item_ref: "i", points: 5, risk: "enorme" }],
      ["estimate_propose", { item_ref: "i", points: 5, rationale: "x".repeat(401) }], ["estimate_get", {}], ["rework_list", { limit: 500 }], ["metrics_get", {}],
    ] as [NomeToolAgil, unknown][]) expect((await falha(chamar(t, a, d.porta))).code, `${t} ${JSON.stringify(a)}`).toBe("invalid_argument");
    expect(d.chamadas).toHaveLength(0);
  });

  it("decidir a estimativa pelo agente (`state` aceita/ajustada/travada) vira rule_violation/human_only e nunca chega à porta", async () => {
    const d = dubleDePorta();
    for (const state of ["aceita", "ajustada", "travada"]) {
      const r = await falha(chamar("estimate_propose", { item_ref: "i", points: 5, state }, d.porta));
      expect(r).toMatchObject({ code: "rule_violation", subcode: "human_only" });
    }
    expect(d.chamadas).toHaveLength(0);
  });

  it("worker nunca usa as tools (segunda barreira), propor exige piloto em squad/agentico", async () => {
    const d = dubleDePorta();
    for (const t of TOOLS_AGIL) expect((await falha(chamar(t, { item_id: "i", item_ref: "i", title: "t", points: 1, metric: "wip" }, d.porta, { role: "executor" }))).subcode, t).toBe("forbidden_role");
    expect((await falha(chamar("backlog_propose", { title: "t" }, d.porta, { mode: "livre", role: "nenhum" }))).subcode).toBe("forbidden_role");
    expect((await falha(chamar("estimate_propose", { item_ref: "i", points: 1 }, d.porta, { mode: "livre", role: "piloto" }))).subcode).toBe("forbidden_role");
    await chamar("backlog_list", {}, dubleDePorta(() => ({ items: [], next: null })).porta, { mode: "livre", role: "nenhum" });
    expect(d.chamadas).toHaveLength(0);
  });

  it("sem a porta (gestão ágil não ligada) as tools respondem `unavailable`; erro desconhecido da porta não vaza detalhe", async () => {
    expect((await falha(chamar("backlog_list", {}, null))).code).toBe("unavailable");
    const quebrada: PortaAgilMcp = { chamar: async () => { throw new Error("SQLITE_BUSY em /Users/x/app.db"); } };
    const r = await falha(chamar("backlog_list", {}, quebrada));
    expect(r.code).toBe("unavailable");
    expect(JSON.stringify(r)).not.toContain("SQLITE");
  });
});

describe("respostas ≤ 4 KB", () => {
  it("backlog_list, rework_list, metrics_get e backlog_get cortam até caber", async () => {
    const itens = Array.from({ length: 100 }, (_, i) => ({ id: `it_${i}`, title: "título comprido ".repeat(8), status: "backlog", points: 3, category: "feature", risk: "alto", criticality: "alta", priority_rank: i + 1 }));
    const l = await chamar("backlog_list", {}, dubleDePorta(() => ({ items: itens, next: "100" })).porta);
    expect(bytes(l)).toBeLessThanOrEqual(4096);
    expect(l["truncated"]).toBe(true);
    const eventos = Array.from({ length: 100 }, (_, i) => ({ task_ref: `T-${i}`, trabalho_id: "feat", fonte: "qa_reprovado", forca: "forte", natureza: "defeito", ocorrido_em: null, ativo: true, confirmado_por: null, evidencia: { a: "x".repeat(80) } }));
    const sit = Array.from({ length: 500 }, (_, i) => ({ trabalho_id: "feat", task_ref: `T-${i}`, situacao: "primeira" }));
    const r = await chamar("rework_list", {}, dubleDePorta(() => ({ eventos, situacoes: sit })).porta);
    expect(bytes(r)).toBeLessThanOrEqual(4096);
    const serie = Array.from({ length: 1000 }, (_, i) => ({ dia: `2027-01-${i}`, valor: i }));
    const mm = await chamar("metrics_get", { metric: "throughput" }, dubleDePorta(() => ({ metric: "throughput", data: serie })).porta);
    expect(bytes(mm)).toBeLessThanOrEqual(4096);
    const grande = await chamar("metrics_get", { metric: "cfd" }, dubleDePorta(() => ({ metric: "cfd", data: { dias: serie, acumulado: serie } })).porta);
    expect(bytes(grande)).toBeLessThanOrEqual(4096);
    const g = await chamar("backlog_get", { item_id: "it_1" }, dubleDePorta(() => ({ id: "it_1", estimates: Array.from({ length: 200 }, (_, i) => ({ version: i, points: 3, note: "x".repeat(60) })) })).porta);
    expect(bytes(g)).toBeLessThanOrEqual(4096);
  });
});

describe("caminho completo: tool -> porta -> serviço -> SQLite", () => {
  const claims = (ws: string, extra: Partial<ClaimsDeAgil> = {}) => claimsDe({ mode: "agentico", role: "piloto", mission_id: "mis_1", pane_id: "pane_1", workspace_id: ws, ...extra });
  async function usar(m: MontagemAgil, nome: NomeToolAgil, args: Record<string, unknown>, ws = WS_A, extra: Partial<ClaimsDeAgil> = {}) {
    const mundo = criarMundo();
    mundo.deps.agil = m.servico.portaMcp;
    return IMPLEMENTACOES[nome](args, { claims: claims(ws, extra), deps: mundo.deps }) as Promise<Record<string, any>>;
  }

  it("proposta do agente entra marcada, a estimativa fica sugerida e outro workspace não enxerga nada", async () => {
    const m = montarAgil(); abertos.push(m);
    const r = await usar(m, "backlog_propose", { title: "Idea do agente", criteria: ["a", "b"] });
    expect(r).toMatchObject({ state: "backlog" });
    const lista = await usar(m, "backlog_list", {});
    expect(lista["items"]).toHaveLength(1);
    expect(lista["items"][0]).toMatchObject({ id: r["item_id"], title: "Idea do agente", status: "backlog", priority_rank: 1 });
    const det = await usar(m, "backlog_get", { item_id: r["item_id"] });
    expect(det).toMatchObject({ proposed_by_agent: true, origin: "ade", criteria: ["a", "b"] });
    const est = await usar(m, "estimate_propose", { item_ref: r["item_id"], points: 5, rationale: "parece médio" });
    expect(est).toMatchObject({ applied: true, state: "sugerida" });
    const eg = await usar(m, "estimate_get", { item_ref: r["item_id"] });
    expect(eg["estimate"]).toMatchObject({ points: 5, origin: "ia", engine: "agente", state: "sugerida" });
    expect((await usar(m, "backlog_list", {}, WS_B))["items"]).toEqual([]);
    expect((await falha(usar(m, "backlog_get", { item_id: r["item_id"] }, WS_B))).code).toBe("not_found");
    // o humano decide e o agente não desfaz
    m.servico.estimativaGravar(WS_A, { item_id: r["item_id"] as string, pontos: 8 });
    expect(await usar(m, "estimate_propose", { item_ref: r["item_id"], points: 1 })).toMatchObject({ applied: false, reason: "humano_prevalece" });
    expect((await usar(m, "estimate_get", { item_ref: r["item_id"] }))["estimate"]).toMatchObject({ points: 8, origin: "humano" });
  });

  it("metrics_get e sprint_status só em leitura, sem texto humano", async () => {
    const m = montarAgil(); abertos.push(m);
    const sp = m.servico.sprintCriar(WS_A, { nome: "S1", inicio: "2027-11-29", fim: "2027-12-12" });
    const st = await usar(m, "sprint_status", { sprint_id: sp.id });
    expect(st["sprint"]).toMatchObject({ id: sp.id, name: "S1", state: "planejada" });
    const mm = await usar(m, "metrics_get", { metric: "health", sprint_id: sp.id });
    expect(mm["metric"]).toBe("health");
    expect(bytes(mm)).toBeLessThanOrEqual(4096);
    const rw = await usar(m, "rework_list", {});
    expect(JSON.stringify(rw)).not.toMatch(/motivo/);
  });
});
