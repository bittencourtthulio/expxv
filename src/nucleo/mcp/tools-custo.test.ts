// Tools do board e do custo (Fase 10, T-10.20): matriz por modo/papel, formato, identidade só do token, somente leitura, ≤ 4 KB, "nunca 0 por omissão"
// e `handoff_submit` com custo inventado que não muda agregado nenhum (CT-10.10).
import { afterEach, describe, expect, it } from "vitest";
import { claimsDe, criarMundo } from "../../../tests/fixtures/mcp/dubles";
import { abrirBanco, migrar, type Banco } from "../banco";
import { criarServicoCusto } from "../custo/servico";
import { DEFINICOES, TOOLS_CUSTO, TOOLS_MVP, ferramentasPermitidas, matrizPorModo } from "./catalogo";
import { ErroMcp } from "./erros";
import type { CardLeveMcp, ClaimsDeCusto, DetalheTaskMcp, PortaCustoMcp } from "./portas";
import { IMPLEMENTACOES } from "./tools/index";

const WORKERS = ["executor", "explorador", "revisor"] as const;
const bytes = (o: unknown): number => Buffer.byteLength(JSON.stringify(o), "utf8");
const card = (n: number, extra: Partial<CardLeveMcp> = {}): CardLeveMcp => ({ task_id: `T-01.${String(n).padStart(2, "0")}`, titulo: `Task número ${n} com um título razoavelmente longo para ocupar bytes`, coluna: "em_andamento", pronta: false, custo: { usd: 0.5, incompleto: false }, ...extra });

describe("matriz por modo/papel", () => {
  it("as 3 tools existem no catálogo com definição coerente", () => {
    expect([...TOOLS_CUSTO]).toEqual(["task_list", "task_get", "cost_report"]);
    for (const t of TOOLS_CUSTO) {
      expect(TOOLS_MVP).toContain(t);
      expect(DEFINICOES[t].name).toBe(t);
      expect(IMPLEMENTACOES[t]).toBeTypeOf("function");
    }
    expect(DEFINICOES.task_get.inputSchema.required).toEqual(["task"]);
    expect(DEFINICOES.cost_report.inputSchema.required).toEqual(["group_by"]);
  });
  it("livre: nenhuma; squad e agêntico: as três; workers: só handoff_submit", () => {
    for (const t of TOOLS_CUSTO) {
      expect(matrizPorModo("livre")).not.toContain(t);
      expect(matrizPorModo("squad")).toContain(t);
      expect(matrizPorModo("agentico")).toContain(t);
      expect(ferramentasPermitidas("livre", "nenhum")).not.toContain(t);
    }
    for (const modo of ["livre", "squad", "agentico"] as const) for (const w of WORKERS) expect(ferramentasPermitidas(modo, w)).toEqual(["handoff_submit"]);
  });
  it("nenhuma das três aceita campo de escrita de custo no schema anunciado", () => {
    for (const t of TOOLS_CUSTO) {
      const props = Object.keys(DEFINICOES[t].inputSchema.properties);
      expect(props.filter((p) => /cost|usd|token/i.test(p))).toEqual([]);
    }
  });
});

function dublePorta(sobre: Partial<PortaCustoMcp> = {}) {
  const chamadas: Array<{ metodo: string; claims: ClaimsDeCusto; p: Record<string, unknown> }> = [];
  const reg = <K extends keyof PortaCustoMcp>(metodo: K, f: (...a: never[]) => unknown) => (async (claims: ClaimsDeCusto, p: Record<string, unknown>) => { chamadas.push({ metodo, claims, p }); return (f as (c: ClaimsDeCusto, p: Record<string, unknown>) => unknown)(claims, p); }) as never;
  const porta: PortaCustoMcp = {
    listarTasks: sobre.listarTasks ?? reg("listarTasks", () => ({ itens: [card(1)], proximo: null })),
    obterTask: sobre.obterTask ?? reg("obterTask", () => detalhe()),
    relatorio: sobre.relatorio ?? reg("relatorio", () => ({ linhas: [], total: { usd: null, incompleto: false, aproximado: false, tokens_entrada: 0, tokens_saida: 0 } })),
  };
  if (sobre.listarTasks) porta.listarTasks = async (c, p) => { chamadas.push({ metodo: "listarTasks", claims: c, p }); return sobre.listarTasks!(c, p); };
  if (sobre.relatorio) porta.relatorio = async (c, p) => { chamadas.push({ metodo: "relatorio", claims: c, p }); return sobre.relatorio!(c, p); };
  if (sobre.obterTask) porta.obterTask = async (c, p) => { chamadas.push({ metodo: "obterTask", claims: c, p }); return sobre.obterTask!(c, p); };
  return { porta, chamadas };
}
function detalhe(extra: Partial<DetalheTaskMcp> = {}): DetalheTaskMcp {
  return { task_id: "T-01.01", titulo: "Task", coluna: "em_andamento", depende_de: ["T-01.00"], contrato: { objetivo: "obj", criterio_aceite: "ac", teste_integracao: null, teste_funcional: null, teste_regressao: null }, janela: { inicio: "2026-06-10T10:00:00.000Z", fim: null, origem: "banco" }, custo: { usd: null, incompleto: true, aproximado: false }, custo_por_modelo: [{ modelo: "x", tokens_entrada: 10, tokens_saida: 5, usd: null, aproximado: false }], panes: [{ pane_id: "p1", cli: "claude", modelo: "x", papel: "executor" }], handoffs: [], ...extra };
}
async function chamar(nome: (typeof TOOLS_CUSTO)[number], args: unknown, porta: PortaCustoMcp | null, claims: Parameters<typeof claimsDe>[0] = {}) {
  const m = criarMundo();
  if (porta !== null) m.deps.custo = porta;
  const c = claimsDe({ mode: "agentico", role: "piloto", mission_id: "mis_1", pane_id: "pane_do_token", workspace_id: "ws_do_token", ...claims });
  return IMPLEMENTACOES[nome](args as Record<string, unknown>, { claims: c, deps: m.deps }) as Promise<Record<string, any>>;
}
async function falha(p: Promise<unknown>): Promise<{ code: string; subcode?: string }> {
  try { await p; } catch (e) { return (e as ErroMcp).corpo(); }
  throw new Error("não falhou");
}

describe("task_list", () => {
  it("a identidade vem do token; campos de identidade/custo nos argumentos são descartados; traduz coluna para inglês", async () => {
    const d = dublePorta({ listarTasks: async () => ({ itens: [card(1, { coluna: "a_fazer", pronta: true, custo: { usd: null, incompleto: false } })], proximo: "c2" }) });
    const r = await chamar("task_list", { status: "todo", limit: 10, workspace_id: "ws_outro", mission_id: "mis_outra", cost: { usd: 0 }, tokens: 9 }, d.porta);
    expect(d.chamadas[0]).toMatchObject({ claims: { workspace_id: "ws_do_token", mission_id: "mis_1", pane_id: "pane_do_token" }, p: { coluna: "a_fazer", limite: 10, trabalho_id: null } });
    expect(Object.keys(d.chamadas[0]?.p ?? {}).sort()).toEqual(["coluna", "cursor", "limite", "trabalho_id"]);
    expect(r["tasks"][0]).toMatchObject({ task_id: "T-01.01", column: "todo", ready: true, cost: { usd: null, incomplete: false } });
    expect(r["next"]).toBe("c2");
  });
  it("custo desconhecido é usd:null (nunca 0)", async () => {
    const d = dublePorta({ listarTasks: async () => ({ itens: [card(1, { custo: { usd: null, incompleto: true } })], proximo: null }) });
    const r = await chamar("task_list", {}, d.porta);
    expect(r["tasks"][0].cost).toEqual({ usd: null, incomplete: true });
  });
  it("recusa status desconhecido, limit > 50 e tipo errado", async () => {
    const d = dublePorta();
    expect((await falha(chamar("task_list", { status: "feito" }, d.porta))).code).toBe("invalid_argument");
    expect((await falha(chamar("task_list", { limit: 51 }, d.porta))).code).toBe("invalid_argument");
    expect((await falha(chamar("task_list", { project: 5 }, d.porta))).code).toBe("invalid_argument");
  });
  it("página de 50 cards cabe em ≤ 4 KB (corta e marca truncated, sem next)", async () => {
    const itens = Array.from({ length: 50 }, (_, i) => card(i + 1));
    const r = await chamar("task_list", { limit: 50 }, dublePorta({ listarTasks: async () => ({ itens, proximo: "mais" }) }).porta);
    expect(bytes(r)).toBeLessThanOrEqual(4096);
    expect(r["truncated"]).toBe(true);
    expect(r["next"]).toBeNull();
    expect(r["tasks"].length).toBeGreaterThan(0);
  });
  it("sem a porta: unavailable; worker e modo livre: forbidden_role", async () => {
    expect((await falha(chamar("task_list", {}, null))).code).toBe("unavailable");
    const d = dublePorta();
    for (const role of WORKERS) expect(await falha(chamar("task_list", {}, d.porta, { role }))).toMatchObject({ code: "rule_violation", subcode: "forbidden_role" });
    expect(await falha(chamar("task_list", {}, d.porta, { mode: "livre", mission_id: null, role: "nenhum" }))).toMatchObject({ subcode: "forbidden_role" });
  });
  it("erro nominal da porta atravessa (outra Missão ⇒ not_found); erro cru vira unavailable sem vazar texto", async () => {
    const nf = dublePorta({ listarTasks: async () => { throw new ErroMcp("not_found", "trabalho fora da Missão"); } });
    expect((await falha(chamar("task_list", { project: "outro" }, nf.porta))).code).toBe("not_found");
    const cru = dublePorta({ listarTasks: async () => { throw new Error("/Users/x/segredo"); } });
    const e = await falha(chamar("task_list", {}, cru.porta));
    expect(e.code).toBe("unavailable");
    expect(JSON.stringify(e)).not.toContain("segredo");
  });
});

describe("task_get", () => {
  it("devolve o completo traduzido; task precisa ser T-NN.MM", async () => {
    const d = dublePorta();
    const r = await chamar("task_get", { task: "T-01.01", project: "abc", usd: 3 }, d.porta);
    expect(d.chamadas[0]?.p).toEqual({ task_id: "T-01.01", trabalho_id: "abc" });
    expect(r).toMatchObject({ task_id: "T-01.01", column: "in_progress", depends_on: ["T-01.00"], cost: { usd: null, incomplete: true, approximate: false }, window: { start: "2026-06-10T10:00:00.000Z", end: null, source: "db" } });
    expect(r["cost_by_model"][0]).toMatchObject({ model: "x", tokens_in: 10, tokens_out: 5, usd: null });
    expect((await falha(chamar("task_get", { task: "../etc" }, d.porta))).code).toBe("invalid_argument");
    expect((await falha(chamar("task_get", {}, d.porta))).code).toBe("invalid_argument");
  });
  it("not_found vem da porta; resposta enorme encolhe para ≤ 4 KB", async () => {
    const grande = detalhe({ contrato: { objetivo: "o".repeat(5000), criterio_aceite: "a".repeat(5000), teste_integracao: "i".repeat(5000), teste_funcional: "f".repeat(5000), teste_regressao: "r".repeat(5000) }, handoffs: Array.from({ length: 30 }, (_, i) => ({ id: `h${i}`, status: "ok", resumo: "r".repeat(400), criado_em: "2026-06-10T10:00:00.000Z" })), custo_por_modelo: Array.from({ length: 30 }, (_, i) => ({ modelo: `m${i}`, tokens_entrada: 1, tokens_saida: 1, usd: 0.1, aproximado: true })) });
    const r = await chamar("task_get", { task: "T-01.01" }, dublePorta({ obterTask: async () => grande }).porta);
    expect(bytes(r)).toBeLessThanOrEqual(4096);
    expect(r["truncated"]).toBe(true);
    const nf = dublePorta({ obterTask: async () => { throw new ErroMcp("not_found", "task não encontrada"); } });
    expect((await falha(chamar("task_get", { task: "T-09.99" }, nf.porta))).code).toBe("not_found");
  });
});

describe("cost_report", () => {
  const total = { usd: 1.5, incompleto: true, aproximado: false, tokens_entrada: 100, tokens_saida: 50 };
  it("traduz o agrupamento, valida datas e não tem caminho de escrita", async () => {
    const d = dublePorta({ relatorio: async () => ({ linhas: [{ chave: "T-01.01", usd: null, incompleto: true, aproximado: false, tokens_entrada: 1, tokens_saida: 2 }], total }) });
    const r = await chamar("cost_report", { group_by: "model", from: "2026-06-01", to: "2026-06-10", usd: 0, cost: { usd: 0.01 }, workspace_id: "x" }, d.porta);
    expect(d.chamadas[0]?.p).toEqual({ agrupar: "modelo", desde: "2026-06-01", ate: "2026-06-10" });
    expect(r["rows"][0]).toEqual({ key: "T-01.01", usd: null, incomplete: true, approximate: false, tokens_in: 1, tokens_out: 2 });
    expect(r["total"]).toMatchObject({ usd: 1.5, incomplete: true });
    expect((await falha(chamar("cost_report", {}, d.porta))).code).toBe("invalid_argument");
    expect((await falha(chamar("cost_report", { group_by: "semana" }, d.porta))).code).toBe("invalid_argument");
    expect((await falha(chamar("cost_report", { group_by: "day", from: "ontem" }, d.porta))).code).toBe("invalid_argument");
    expect((await falha(chamar("cost_report", { group_by: "day", from: "2026-06-10", to: "2026-06-01" }, d.porta))).code).toBe("invalid_argument");
  });
  it("relatório grande ≤ 4 KB; sem registros ⇒ usd null (não 0)", async () => {
    const linhas = Array.from({ length: 200 }, (_, i) => ({ chave: `pane_${i}_${"x".repeat(30)}`, usd: i, incompleto: false, aproximado: false, tokens_entrada: i, tokens_saida: i }));
    const r = await chamar("cost_report", { group_by: "pane" }, dublePorta({ relatorio: async () => ({ linhas, total }) }).porta);
    expect(bytes(r)).toBeLessThanOrEqual(4096);
    expect(r["truncated"]).toBe(true);
    const vazio = await chamar("cost_report", { group_by: "day" }, dublePorta().porta);
    expect(vazio["total"].usd).toBeNull();
  });
  it("workers e modo livre não leem custo", async () => {
    const d = dublePorta();
    for (const role of WORKERS) expect(await falha(chamar("cost_report", { group_by: "task" }, d.porta, { role }))).toMatchObject({ subcode: "forbidden_role" });
    expect(await falha(chamar("cost_report", { group_by: "task" }, d.porta, { mode: "livre", mission_id: null, role: "nenhum" }))).toMatchObject({ subcode: "forbidden_role" });
  });
});

describe("handoff_submit com custo inventado (CT-10.10)", () => {
  const abertos: Banco[] = [];
  afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
  it("cost/tokens/usd extras não chegam ao serviço de handoff e nenhum agregado muda", async () => {
    const b = abrirBanco(":memory:");
    abertos.push(b);
    migrar(b);
    const svc = criarServicoCusto({ banco: b });
    const antes = JSON.stringify([b.consultar("SELECT * FROM custo_agregado"), b.consultar("SELECT * FROM uso_registro"), svc.diagnostico()]);
    const m = criarMundo();
    let recebido: Record<string, unknown> | null = null;
    m.deps.handoff = { ...m.deps.handoff, registrar: async (p) => { recebido = p as unknown as Record<string, unknown>; return { handoff_id: "h1" }; } };
    const c = claimsDe({ role: "executor", mode: "agentico", pane_id: "p_exec" });
    await IMPLEMENTACOES.handoff_submit({ task_id: "t-1", summary: "feito", report_path: "r.md", status: "ok", cost: { usd: 0.01 }, tokens: 123, usd: 5, cost_usd: 1 }, { claims: c, deps: m.deps });
    expect(Object.keys(recebido ?? {}).filter((k) => /cost|token|usd/i.test(k))).toEqual([]);
    const depois = JSON.stringify([b.consultar("SELECT * FROM custo_agregado"), b.consultar("SELECT * FROM uso_registro"), svc.diagnostico()]);
    expect(depois).toBe(antes);
  });
});
