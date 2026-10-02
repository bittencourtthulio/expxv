// Tools da Fase 14 (T-14.13): agent_list e agent_invoke. A porta é um dublê: aqui se prova o CONTRATO externo (matriz por modo/papel,
// identidade só do token, validação, erros preservados, ≤ 4 KB, nunca texto de prompt). A lógica real é de `squads/invocacao.test.ts`.
import { describe, expect, it } from "vitest";
import { claimsDe, criarMundo } from "../../../tests/fixtures/mcp/dubles";
import { DEFINICOES, TOOLS_MVP, TOOLS_SQUADS, ferramentasPermitidas } from "./catalogo";
import { ErroMcp } from "./erros";
import type { AgenteListado, ClaimsDeSquad, PedidoInvocarAgente, PortaSquads } from "./portas";
import { IMPLEMENTACOES } from "./tools/index";

const agente = (n: number, extra: Partial<AgenteListado> = {}): AgenteListado => ({ agent_id: `eq.m${n}`, role: "executor", label: `M${n}`, description: `faz a coisa ${n}`, tier: "alto", max_instances: 2, in_flight: 0, ...extra });

function porta(sobre: Partial<PortaSquads> = {}): PortaSquads & { listados: string[]; invocados: Array<{ claims: ClaimsDeSquad; args: PedidoInvocarAgente }> } {
  const listados: string[] = [];
  const invocados: Array<{ claims: ClaimsDeSquad; args: PedidoInvocarAgente }> = [];
  return {
    listados,
    invocados,
    listar: async (id) => {
      listados.push(id);
      return { agents: [agente(1), agente(2, { role: "reviewer" })] };
    },
    invocar: async (claims, args) => {
      invocados.push({ claims, args });
      return { pane_id: "pane_novo", invocation_id: "inv_1" };
    },
    ...sobre,
  };
}
const piloto = (modo: "squad" | "agentico" = "squad", extra: Parameters<typeof claimsDe>[0] = {}) =>
  claimsDe({ mode: modo, role: "piloto", mission_id: "mis_1", tools_allow: [...ferramentasPermitidas(modo, "piloto", { comSquad: true })], ...extra });

async function chamar(nome: "agent_list" | "agent_invoke", args: unknown, p: PortaSquads | null = porta(), claims = piloto()) {
  const m = criarMundo();
  if (p !== null) m.deps.squads = p;
  return IMPLEMENTACOES[nome](args as Record<string, unknown>, { claims, deps: m.deps }) as Promise<Record<string, any>>;
}
async function falha(p: Promise<unknown>): Promise<{ code: string; subcode?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return (e as ErroMcp).corpo();
  }
  throw new Error("não falhou");
}
const bytes = (o: unknown): number => Buffer.byteLength(JSON.stringify(o), "utf8");

describe("matriz por modo e papel", () => {
  it("as duas tools existem no catálogo e têm definição anunciada", () => {
    for (const t of TOOLS_SQUADS) {
      expect(TOOLS_MVP).toContain(t);
      expect(DEFINICOES[t].name).toBe(t);
    }
    expect([...TOOLS_SQUADS]).toEqual(["agent_list", "agent_invoke"]);
    expect(DEFINICOES.agent_invoke.inputSchema.required).toEqual(["agent_id"]);
  });
  it("só o piloto COM squad (modo squad ou agêntico) as vê; livre, workers e piloto sem squad nunca", () => {
    for (const modo of ["squad", "agentico"] as const) {
      expect(ferramentasPermitidas(modo, "piloto", { comSquad: true })).toEqual(expect.arrayContaining(["agent_list", "agent_invoke"]));
      expect(ferramentasPermitidas(modo, "piloto")).not.toContain("agent_invoke");
      expect(ferramentasPermitidas(modo, "piloto", { comSquad: false })).not.toContain("agent_list");
      for (const papel of ["executor", "explorador", "revisor"] as const) expect(ferramentasPermitidas(modo, papel, { comSquad: true })).toEqual(["handoff_submit"]);
    }
    for (const papel of ["piloto", "nenhum", "executor"] as const) expect(ferramentasPermitidas("livre", papel, { comSquad: true })).not.toContain("agent_list");
  });
  it("agêntico com squad conserva o resto da matriz (sem harness_set sem o opt-in); squad com squad mantém a leitura da Fase 9", () => {
    const ag = ferramentasPermitidas("agentico", "piloto", { comSquad: true });
    expect(ag).not.toContain("harness_set");
    expect(ag).toContain("account_switch");
    expect(ferramentasPermitidas("agentico", "piloto", { comSquad: true, pilotoEditaPolitica: true })).toEqual(expect.arrayContaining(["harness_set", "agent_invoke"]));
    expect(ferramentasPermitidas("squad", "piloto", { comSquad: true })).toEqual(expect.arrayContaining(["harness_list", "headline_limits", "mission_complete", "pane_spawn"]));
  });
});

describe("agent_list", () => {
  it("lista os agentes da Missão do TOKEN (argumentos de identidade são ignorados)", async () => {
    const p = porta();
    const r = await chamar("agent_list", { mission_id: "mis_outra", workspace_id: "ws_x" }, p);
    expect(p.listados).toEqual(["mis_1"]);
    expect(r["agents"]).toHaveLength(2);
    expect(r["agents"][0]).toEqual({ agent_id: "eq.m1", role: "executor", label: "M1", description: "faz a coisa 1", tier: "alto", max_instances: 2, in_flight: 0 });
  });
  it("nunca devolve texto de prompt, mesmo que a porta o entregue por engano, e cabe em 4 KB marcando truncated", async () => {
    const muitos = Array.from({ length: 40 }, (_, i) => ({ ...agente(i), description: "d".repeat(140), prompt: "SEGREDO DO PROMPT" }));
    const r = await chamar("agent_list", {}, porta({ listar: async () => ({ agents: muitos as AgenteListado[] }) }));
    expect(JSON.stringify(r)).not.toContain("SEGREDO");
    expect(bytes(r)).toBeLessThanOrEqual(4096);
    expect(r["truncated"]).toBe(true);
    expect(r["total"]).toBe(40);
  });
  it("sem Missão, de worker ou sem a porta: erros do contrato", async () => {
    expect(await falha(chamar("agent_list", {}, porta(), piloto("squad", { mission_id: null })))).toMatchObject({ code: "rule_violation", subcode: "not_in_mission" });
    expect(await falha(chamar("agent_list", {}, porta(), piloto("squad", { role: "executor" })))).toMatchObject({ code: "rule_violation", subcode: "forbidden_role" });
    expect(await falha(chamar("agent_list", {}, null))).toMatchObject({ code: "unavailable" });
  });
  it("erro nominal da porta é preservado; erro de infraestrutura vira unavailable sem detalhe", async () => {
    expect(await falha(chamar("agent_list", {}, porta({ listar: async () => { throw new ErroMcp("not_found", "A Missão não tem squad."); } })))).toMatchObject({ code: "not_found" });
    const f = await falha(chamar("agent_list", {}, porta({ listar: async () => { throw new Error("SQLITE /Users/x/segredo.db"); } })));
    expect(f).toMatchObject({ code: "unavailable" });
    expect(f.message).not.toContain("segredo");
  });
});

describe("agent_invoke", () => {
  it("a identidade vem do token; `task_id` é aceito e ignorado; devolve só pane_id e invocation_id", async () => {
    const p = porta();
    const r = await chamar("agent_invoke", { agent_id: "eq.m1", task_id: "t-9", briefing_path: ".expxv/missoes/mis_1/b.md", mission_id: "mis_outra", role: "orchestrator", pane_id: "pane_x" }, p);
    expect(r).toEqual({ pane_id: "pane_novo", invocation_id: "inv_1" });
    expect(p.invocados).toEqual([{ claims: { workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_p", role: "piloto", mode: "squad" }, args: { agent_id: "eq.m1", briefing_path: ".expxv/missoes/mis_1/b.md" } }]);
  });
  it("prompt até 4000 caracteres passa; acima disso é invalid_argument sem chamar a porta", async () => {
    const p = porta();
    await chamar("agent_invoke", { agent_id: "eq.m1", prompt: "a".repeat(4000) }, p);
    expect(p.invocados[0]!.args.prompt).toHaveLength(4000);
    expect(await falha(chamar("agent_invoke", { agent_id: "eq.m1", prompt: "a".repeat(4001) }, p))).toMatchObject({ code: "invalid_argument" });
    expect(p.invocados).toHaveLength(1);
  });
  it("agent_id ausente, vazio, não texto ou com caractere de controle é invalid_argument", async () => {
    const p = porta();
    for (const args of [{}, { agent_id: "" }, { agent_id: 7 }, { agent_id: "eq.m1\u0000" }, { agent_id: "eq.m1", briefing_path: 3 }]) {
      expect(await falha(chamar("agent_invoke", args, p)), JSON.stringify(args)).toMatchObject({ code: "invalid_argument" });
    }
    expect(p.invocados).toEqual([]);
  });
  it("só o piloto invoca (worker e `nenhum`: forbidden_role), e só dentro de uma Missão (not_in_mission); sem a porta: unavailable", async () => {
    const p = porta();
    for (const role of ["executor", "explorador", "revisor", "nenhum"] as const) {
      expect(await falha(chamar("agent_invoke", { agent_id: "eq.m1" }, p, piloto("squad", { role })))).toMatchObject({ code: "rule_violation", subcode: "forbidden_role" });
    }
    expect(await falha(chamar("agent_invoke", { agent_id: "eq.m1" }, p, piloto("squad", { mission_id: null })))).toMatchObject({ subcode: "not_in_mission" });
    expect(await falha(chamar("agent_invoke", { agent_id: "eq.m1" }, p, piloto("livre" as never)))).toMatchObject({ subcode: "forbidden_role" });
    expect(p.invocados).toEqual([]);
    expect(await falha(chamar("agent_invoke", { agent_id: "eq.m1" }, null))).toMatchObject({ code: "unavailable" });
  });
  it("preserva code/subcode dos erros da porta (gate_pending, limit_reached, provider_disabled, forbidden_role, not_found)", async () => {
    const casos: Array<[ErroMcp, string, string | undefined]> = [
      [new ErroMcp("rule_violation", "portão pendente", "gate_pending"), "rule_violation", "gate_pending"],
      [new ErroMcp("rule_violation", "limite", "limit_reached"), "rule_violation", "limit_reached"],
      [new ErroMcp("rule_violation", "provedor", "provider_disabled"), "rule_violation", "provider_disabled"],
      [new ErroMcp("rule_violation", "fora", "forbidden_role"), "rule_violation", "forbidden_role"],
      [new ErroMcp("not_found", "sem squad"), "not_found", undefined],
    ];
    for (const [erro, code, subcode] of casos) {
      const f = await falha(chamar("agent_invoke", { agent_id: "eq.m1" }, porta({ invocar: async () => { throw erro; } })));
      expect(f.code).toBe(code);
      expect(f.subcode).toBe(subcode);
    }
  });
  it("falha de infraestrutura vira unavailable sem vazar detalhe", async () => {
    const f = await falha(chamar("agent_invoke", { agent_id: "eq.m1" }, porta({ invocar: async () => { throw new Error("EACCES /Users/x/.ssh/id_rsa"); } })));
    expect(f).toMatchObject({ code: "unavailable" });
    expect(f.message).not.toContain("id_rsa");
  });
});
