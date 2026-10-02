import { describe, expect, it } from "vitest";
import { claimsDe, criarMundo } from "../../../tests/fixtures/mcp/dubles";
import { MODOS_MISSAO, PAPEIS } from "../dominio";
import { DEFINICOES, TOOLS_AVULSO, TOOLS_MVP, ferramentasPermitidas } from "./catalogo";
import { criarEmissorDeTokens } from "./tokens";
import { IMPLEMENTACOES } from "./tools/index";

// D-421: o painel livre que orquestra (piloto avulso) recebe o MÍNIMO para abrir e acompanhar workers. Nada de maestro, troca de conta, harness_set,
// Loja, mission_complete (D-21), memória, RAG, mapa, alertas ou gestão ágil.
const PROIBIDAS = [
  "maestro_request", "maestro_status", "account_switch", "harness_set", "harness_list", "harness_recommend", "headline_pick", "headline_limits", "decisions_list",
  "mcp_store_list", "catalog_list", "mission_complete", "mission_list", "handoff_submit", "agent_list", "agent_invoke", "alert_raise",
  "memory_write", "memory_search", "memory_checkpoint", "memory_brief", "memory_forget", "rag_search", "rag_context", "rag_learn", "rag_feedback",
  "map_status", "map_query", "map_impact", "map_evidence", "backlog_propose", "estimate_propose",
] as const;

const base = { workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_1", role: "piloto" as const, mode: "agentico" as const };

describe("matriz de tools do painel avulso (D-421)", () => {
  it("exatamente o mínimo para orquestrar workers", () => {
    expect([...TOOLS_AVULSO].sort()).toEqual(["cost_report", "handoff_read", "model_list", "pane_close", "pane_list", "pane_read", "pane_send", "pane_spawn", "provider_list", "task_get", "task_list"]);
    expect([...ferramentasPermitidas("agentico", "piloto", { avulso: true })].sort()).toEqual([...TOOLS_AVULSO].sort());
  });

  it("nenhuma tool de escalonamento entra, nem com todas as opções ligadas", () => {
    const todas = { avulso: true, maestro: true, agil: true, alertas: "todos" as const, rag: true, mapa: true, memoria: "solo" as const, pilotoEditaPolitica: true, comSquad: true };
    const lista = ferramentasPermitidas("agentico", "piloto", todas);
    for (const t of PROIBIDAS) expect(lista).not.toContain(t);
    expect(lista).toEqual(ferramentasPermitidas("agentico", "piloto", { avulso: true }));
  });

  it("avulso só vale para piloto em modo agêntico: qualquer outra combinação fica sem tool (deny-by-default)", () => {
    for (const modo of MODOS_MISSAO) {
      for (const papel of PAPEIS) {
        const lista = ferramentasPermitidas(modo, papel, { avulso: true });
        if (modo === "agentico" && papel === "piloto") expect(lista.length).toBe(TOOLS_AVULSO.length);
        else expect(lista).toEqual([]);
      }
    }
  });

  it("o token do avulso carrega só a lista mínima e `tools_allow` ainda só restringe", () => {
    const e = criarEmissorDeTokens();
    const c = e.verificar(e.emitir({ ...base, avulso: true, tools_allow: [...TOOLS_AVULSO] }));
    expect(c?.tools_allow.sort()).toEqual([...TOOLS_AVULSO].sort());
    const estreito = e.verificar(e.emitir({ ...base, avulso: true, tools_allow: ["pane_list", "maestro_request"] }));
    expect(estreito?.tools_allow).toEqual(["pane_list"]);
  });

  it("painel livre SEM opt-in continua sem pane_spawn: token `nenhum`/livre com tools_allow vazio não vê nada", () => {
    const e = criarEmissorDeTokens();
    const livre = e.verificar(e.emitir({ workspace_id: "ws_1", mission_id: null, pane_id: "pane_2", role: "nenhum", mode: "livre", tools_allow: [] }));
    expect(livre?.tools_allow).toEqual([]);
    // sem `avulso` o piloto agêntico continua com a matriz de sempre (a mudança não afeta Missões reais)
    const real = e.verificar(e.emitir(base));
    expect(real?.tools_allow).toContain("mission_complete");
    expect(real?.tools_allow).toContain("handoff_submit");
  });

  it("workers da Missão avulsa (executor/explorador/revisor) só entregam: não existe pane_spawn para eles (profundidade 1)", () => {
    for (const papel of ["executor", "explorador", "revisor"] as const) {
      expect(ferramentasPermitidas("agentico", papel, { avulso: true })).toEqual([]);
      expect(ferramentasPermitidas("agentico", papel)).toEqual(["handoff_submit"]);
    }
  });

  it("toda tool avulsa existe no catálogo e a descrição de pane_spawn manda usar a tool no lugar de subagentes internos", () => {
    for (const t of TOOLS_AVULSO) expect((TOOLS_MVP as readonly string[]).includes(t)).toBe(true);
    expect(DEFINICOES.pane_spawn.description).toMatch(/terminal/i);
    expect(DEFINICOES.pane_spawn.description).toMatch(/subagentes internos/i);
    expect(Object.keys(DEFINICOES.pane_spawn.inputSchema.properties)).toEqual(expect.arrayContaining(["prompt", "title", "isolate"]));
  });
});

const claimsAvulso = () => claimsDe({ mode: "agentico", role: "piloto", mission_id: "mis_1", tools_allow: [...TOOLS_AVULSO] });
async function falha(p: Promise<unknown>): Promise<{ code: string; subcode?: string; message: string }> {
  try { await p; } catch (e) { return (e as { corpo(): { code: string; subcode?: string; message: string } }).corpo(); }
  throw new Error("não falhou");
}

describe("pane_spawn do painel avulso: limites e repasse (D-423)", () => {
  it("repassa prompt, title e isolate ao main (que grava o briefing e decide o worktree)", async () => {
    const m = criarMundo();
    await IMPLEMENTACOES.pane_spawn({ provider: "codex", role: "scout", prompt: "Busque notícias de IA de hoje.", title: "Notícias 1", isolate: false }, { claims: claimsAvulso(), deps: m.deps });
    expect(m.spawns[0]).toMatchObject({ prompt: "Busque notícias de IA de hoje.", titulo: "Notícias 1", isolar: false, papel: "explorador", mission_id: "mis_1" });
  });

  it("prompt e briefing_path juntos, isolate não booleano e prompt gigante são recusados", async () => {
    const m = criarMundo();
    const ctx = { claims: claimsAvulso(), deps: m.deps };
    expect((await falha(IMPLEMENTACOES.pane_spawn({ provider: "claude", prompt: "x", briefing_path: "b.md" }, ctx))).code).toBe("invalid_argument");
    expect((await falha(IMPLEMENTACOES.pane_spawn({ provider: "claude", isolate: "sim" }, ctx))).code).toBe("invalid_argument");
    expect((await falha(IMPLEMENTACOES.pane_spawn({ provider: "claude", prompt: "x".repeat(4001) }, ctx))).code).toBe("invalid_argument");
    expect(m.spawns).toHaveLength(0);
  });

  it("o 9º worker do painel é recusado com limit_reached (8 por painel)", async () => {
    const m = criarMundo();
    const ctx = { claims: claimsAvulso(), deps: m.deps };
    for (let i = 0; i < 8; i++) await IMPLEMENTACOES.pane_spawn({ provider: "claude", prompt: `tarefa ${i}` }, ctx);
    expect(await falha(IMPLEMENTACOES.pane_spawn({ provider: "claude", prompt: "a nona" }, ctx))).toMatchObject({ code: "rule_violation", subcode: "limit_reached" });
    expect(m.spawns).toHaveLength(8);
  });

  it("profundidade 1: worker (executor) não abre worker nem pelo tool direto (forbidden_role)", async () => {
    const m = criarMundo();
    const worker = claimsDe({ mode: "agentico", role: "executor", mission_id: "mis_1", pane_id: "pane_w" });
    expect(await falha(IMPLEMENTACOES.pane_spawn({ provider: "claude", prompt: "recursão" }, { claims: worker, deps: m.deps }))).toMatchObject({ subcode: "forbidden_role" });
    expect(m.spawns).toHaveLength(0);
  });

  it("aprovacao (D-640): só abaixa o nível; 'total' e valores inventados são recusados e nada abre", async () => {
    const m = criarMundo();
    const ctx = { claims: claimsAvulso(), deps: m.deps };
    await IMPLEMENTACOES.pane_spawn({ provider: "claude", prompt: "x", aprovacao: "perguntar" }, ctx);
    await IMPLEMENTACOES.pane_spawn({ provider: "claude", prompt: "y", aprovacao: "automatico_seguro" }, ctx);
    expect(m.spawns.map((x) => x.aprovacao)).toEqual(["perguntar", "automatico_seguro"]);
    for (const ruim of ["total", "bypass", true, 1]) expect((await falha(IMPLEMENTACOES.pane_spawn({ provider: "claude", prompt: "z", aprovacao: ruim }, ctx))).code).toBe("invalid_argument");
    expect(m.spawns).toHaveLength(2);
    const enumeracao = (DEFINICOES.pane_spawn.inputSchema.properties["aprovacao"] as { enum: string[] }).enum;
    expect(enumeracao).toEqual(["perguntar", "automatico_seguro"]);
  });
});
