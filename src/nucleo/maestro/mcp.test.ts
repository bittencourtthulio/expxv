// T-16.27 · Adaptador MCP sobre o ServicoMaestro REAL (mundo falso por portas): idempotência, loop_guard, `level` só sobe, nunca executa direto.
import { describe, expect, it } from "vitest";
import { criarMundo, WS } from "../../../tests/fixtures/maestro/mundo";
import { ErroMcp } from "../mcp/erros";
import type { ClaimsDeMaestro } from "../mcp/portas";
import { criarPortaMaestroMcp, erroMcpDoMaestro } from "./mcp";
import { MaestroErro } from "./servico";

const claims = (extra: Partial<ClaimsDeMaestro> = {}): ClaimsDeMaestro => ({ workspace_id: WS, mission_id: null, pane_id: "paneLivre", role: "nenhum", mode: "livre", ...extra });
const BUG = "corrige, estou com um problema no cadastro de clientes: não salva o telefone, dá erro 500";
function montar(o: Parameters<typeof criarMundo>[0] = {}) {
  const m = criarMundo(o);
  const porta = criarPortaMaestroMcp(m.servico, { niveis: m.portas.niveis });
  return { m, porta };
}
async function codigo(p: Promise<unknown>): Promise<ErroMcp> {
  try { await p; } catch (e) { return e as ErroMcp; }
  throw new Error("não falhou");
}

describe("maestro_request pelo serviço real", () => {
  it("bug => plano PROPOSTO (runx), nada executa e nenhum terminal abre", async () => {
    const { m, porta } = montar();
    const r = await porta.pedir(claims(), { text: BUG, files: [], excerpt: null, level: null });
    expect(r).toMatchObject({ intent: "bug", pipeline: "runx", state: "proposed", needs_user_confirmation: true });
    expect(r.stages.length).toBeGreaterThan(2);
    expect(r.stages[0]).toEqual(expect.objectContaining({ id: expect.any(String), skill: expect.any(String) }));
    expect(r.message).toMatch(/Não implemente/);
    expect(m.vivos()).toHaveLength(0);
    expect(m.persistencia.todos()[0]).toMatchObject({ via: "mcp", estado: "proposto", origem_pane_id: "paneLivre" });
  });
  it("idempotente: o mesmo texto no mesmo Pane devolve o MESMO plano", async () => {
    const { m, porta } = montar();
    const a = await porta.pedir(claims(), { text: BUG, files: [], excerpt: null, level: null });
    const b = await porta.pedir(claims(), { text: BUG, files: [], excerpt: null, level: null });
    expect(b.plan_id).toBe(a.plan_id);
    expect(m.persistencia.todos()).toHaveLength(1);
  });
  it("Pane de etapa do Maestro: permitido=false e pedir => loop_guard (rule_violation)", async () => {
    const { m, porta } = montar();
    m.servico.registrarPaneDoMaestro("paneEtapa");
    expect(await porta.permitido("paneEtapa")).toBe(false);
    expect(await porta.permitido("paneLivre")).toBe(true);
    const e = await codigo(porta.pedir(claims({ pane_id: "paneEtapa" }), { text: BUG, files: [], excerpt: null, level: null }));
    expect(e).toMatchObject({ code: "rule_violation", subcode: "loop_guard" });
    expect((await codigo(porta.status(claims({ pane_id: "paneEtapa" }), null))).subcode).toBe("loop_guard");
    expect(m.persistencia.todos()).toHaveLength(0);
  });
  it("`level` só SOBE: igual ou abaixo do vigente é ignorado; acima vira nivel_pedido", async () => {
    const { m, porta } = montar({ nivelWorkspace: 3 });
    const baixo = await porta.pedir(claims(), { text: BUG, files: [], excerpt: null, level: 1 });
    expect(m.persistencia.todos().find((p) => p.id === baixo.plan_id)).toMatchObject({ nivel_pedido: null, nivel_atual: 3 });
    const { m: m2, porta: porta2 } = montar({ nivelWorkspace: 3 });
    const alto = await porta2.pedir(claims(), { text: BUG, files: [], excerpt: null, level: 5 });
    expect(m2.persistencia.todos().find((p) => p.id === alto.plan_id)).toMatchObject({ nivel_pedido: 5, nivel_atual: 5 });
  });
  it("nunca pede 'executar direto' pela tool, mesmo com confirmar_plano=0 no pedido (o workspace decide, não o agente)", async () => {
    const { m, porta } = montar();
    const espia: unknown[] = [];
    const servico = { pedir: async (p: Parameters<typeof m.servico.pedir>[0]) => { espia.push(p); return m.servico.pedir(p); }, estado: (id: string) => m.servico.estado(id), status: (ws: string) => m.servico.status(ws), ehPaneDoMaestro: (id: string) => m.servico.ehPaneDoMaestro(id) };
    await criarPortaMaestroMcp(servico, { niveis: m.portas.niveis }).pedir(claims(), { text: BUG, files: ["src/a.ts"], excerpt: "x", level: null });
    expect(espia[0]).toMatchObject({ via: "mcp", executar_direto: null, contexto: { pane_id: "paneLivre", arquivos: ["src/a.ts"], trecho: "x" } });
    void porta;
  });
  it("texto que começa com o marcador do Maestro nunca é reclassificado (invalid_argument)", async () => {
    const { porta, m } = montar();
    expect((await codigo(porta.pedir(claims(), { text: "[maestro] corrige o erro no cadastro", files: [], excerpt: null, level: null }))).code).toBe("invalid_argument");
    expect(m.persistencia.todos()).toHaveLength(0);
  });
  it("taxa excedida (7º pedido distinto no minuto) => rule_violation/limit_reached", async () => {
    const { porta } = montar();
    let ultimo: unknown = null;
    for (let i = 0; i < 8; i++) {
      try { await porta.pedir(claims(), { text: `corrige o erro número ${i} no cadastro de clientes que não salva`, files: [], excerpt: null, level: null }); } catch (e) { ultimo = e; }
    }
    expect(ultimo).toMatchObject({ code: "rule_violation", subcode: "limit_reached" });
  });
});

describe("maestro_status pelo serviço real", () => {
  it("lista só os pipelines ATIVOS do workspace do token e filtra por plan_id (outro workspace => vazio)", async () => {
    const { porta } = montar();
    const r = await porta.pedir(claims(), { text: BUG, files: [], excerpt: null, level: null });
    const todos = await porta.status(claims(), null);
    expect(todos.pipelines.map((p) => p.id)).toEqual([r.plan_id]);
    expect(todos.pipelines[0]).toMatchObject({ state: "proposto", level: expect.any(Number) });
    expect((await porta.status(claims(), r.plan_id)).pipelines).toHaveLength(1);
    expect((await porta.status(claims({ workspace_id: "outro" }), r.plan_id)).pipelines).toEqual([]);
    expect((await porta.status(claims({ workspace_id: "outro" }), null)).pipelines).toEqual([]);
  });
});

describe("erroMcpDoMaestro", () => {
  it("traduz cada código sem vazar detalhe", () => {
    expect(erroMcpDoMaestro(new MaestroErro("loop_guard", "x"))).toMatchObject({ code: "rule_violation", subcode: "loop_guard" });
    expect(erroMcpDoMaestro(new MaestroErro("taxa_excedida", "x"))).toMatchObject({ code: "rule_violation", subcode: "limit_reached" });
    expect(erroMcpDoMaestro(new MaestroErro("invalid_argument", "x")).code).toBe("invalid_argument");
    expect(erroMcpDoMaestro(new MaestroErro("plano_inexistente", "x")).code).toBe("not_found");
    expect(erroMcpDoMaestro(new MaestroErro("indisponivel", "/Users/x/segredo")).message).not.toContain("segredo");
    expect(erroMcpDoMaestro(new Error("/Users/x/segredo")).code).toBe("unavailable");
  });
});
