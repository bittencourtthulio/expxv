// `pane_spawn` sem provedor (route auto) e `account_switch` (Fase 9, T-09.16 e T-09.20). As portas são dublês: aqui se prova o CONTRATO
// externo (formato, erros, regressão do MVP, papéis); a rota real e o movimento real são provados em `main/harness.test.ts` e `main/harness-mover.test.ts`.
import { describe, expect, it } from "vitest";
import { claimsDe, criarMundo } from "../../../tests/fixtures/mcp/dubles";
import { DEFINICOES, TOOLS_HARNESS, ferramentasPermitidas } from "./catalogo";
import { ErroMcp } from "./erros";
import type { PortaRota, PortaTroca, ResultadoRotaSpawn, RotaDoSpawn } from "./portas";
import { IMPLEMENTACOES } from "./tools/index";

const rotaPadrao: RotaDoSpawn = {
  provedor: "claude",
  cli: "claude",
  modelo: null,
  esforco: null,
  conta_id: "conta_a",
  faixa: "medio",
  task_type: "front",
  recibo: "Conta A reseta primeiro; tipo front por heurística.",
  decisoes: ["task_type=front (regra)", "conta=conta_a"],
  skills: ["expx:designx"],
  decisao_id: "dec_1",
};

function portaRota(sobre: Partial<PortaRota> = {}, resultado: ResultadoRotaSpawn = { ok: true, ...rotaPadrao }): PortaRota & { pedidos: unknown[]; gravados: unknown[] } {
  const pedidos: unknown[] = [];
  const gravados: unknown[] = [];
  return {
    pedidos,
    gravados,
    nivel: async () => 4,
    rotear: async (p) => (pedidos.push(p), resultado),
    gravar: async (id, r, ag) => void gravados.push([id, r, ag]),
    ...sobre,
  };
}

const piloto = () => claimsDe({ mode: "agentico", role: "piloto", mission_id: "mis_1", tools_allow: [...ferramentasPermitidas("agentico", "piloto")] });
async function spawn(args: unknown, rota: PortaRota | undefined, m = criarMundo()) {
  if (rota !== undefined) m.deps.rota = rota;
  const r = await IMPLEMENTACOES["pane_spawn"](args as Record<string, unknown>, { claims: piloto(), deps: m.deps });
  return { r: r as Record<string, any>, m };
}
async function falha(p: Promise<unknown>): Promise<{ code: string; subcode?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return (e as { corpo(): { code: string; subcode?: string; message: string } }).corpo();
  }
  throw new Error("não falhou");
}

describe("pane_spawn sem provider (route auto)", () => {
  it("roteia, abre o Pane na CLI/conta escolhidas, grava a rota e devolve { pane_id, receipt, decisions }", async () => {
    const rota = portaRota();
    const { r, m } = await spawn({ task_description: "arrumar o botão da home", role: "executor", briefing_path: "b.md" }, rota);
    expect(r).toEqual({ pane_id: "pane_w1", receipt: rotaPadrao.recibo, decisions: rotaPadrao.decisoes });
    expect(m.spawns[0]).toMatchObject({ provedor: "claude", conta_id: "conta_a", modelo: null, papel: "executor", skills: ["expx:designx"] });
    expect(rota.pedidos[0]).toMatchObject({ workspace_id: "ws_1", mission_id: "mis_1", papel: "executor", descricao: "arrumar o botão da home", task_type: null });
    expect(rota.gravados).toEqual([["pane_w1", rotaPadrao, null]]);
  });

  it("recibo ≤ 240 caracteres e decisions ≤ 10", async () => {
    const rota = portaRota({}, { ok: true, ...rotaPadrao, recibo: "r".repeat(900), decisoes: Array.from({ length: 30 }, (_, i) => `d${i}`) });
    const { r } = await spawn({}, rota);
    expect([...r["receipt"]].length).toBe(240);
    expect(r["decisions"]).toHaveLength(10);
  });

  it("com provider explícito o comportamento é o do MVP: só { pane_id }, sem rota nem skills", async () => {
    const rota = portaRota();
    const { r, m } = await spawn({ provider: "codex" }, rota);
    expect(r).toEqual({ pane_id: "pane_w1" });
    expect(rota.pedidos).toHaveLength(0);
    expect(rota.gravados).toHaveLength(0);
    expect(m.spawns[0]).not.toHaveProperty("skills");
  });

  it('route:"none" sem provider ⇒ invalid_argument; route fora do conjunto também', async () => {
    const m = criarMundo();
    m.deps.rota = portaRota();
    expect(await falha(spawn({ route: "none" }, undefined, m))).toMatchObject({ code: "invalid_argument" });
    expect((await falha(spawn({ route: "talvez" }, undefined, m))).code).toBe("invalid_argument");
    expect((await falha(spawn({ faixa: "supremo" }, undefined, m))).code).toBe("invalid_argument");
  });

  it("sem a porta de rota o provider continua obrigatório (erro do MVP)", async () => {
    expect((await falha(spawn({}, undefined))).code).toBe("invalid_argument");
  });

  it("nível 1 nunca roteia; nível 2 só com route:auto explícito; nível 3+ é automático por padrão", async () => {
    expect((await falha(spawn({ route: "auto" }, portaRota({ nivel: async () => 1 })))).code).toBe("invalid_argument");
    expect((await falha(spawn({}, portaRota({ nivel: async () => 2 })))).code).toBe("invalid_argument");
    expect((await spawn({ route: "auto" }, portaRota({ nivel: async () => 2 }))).r["pane_id"]).toBe("pane_w1");
    expect((await spawn({}, portaRota({ nivel: async () => 3 }))).r["pane_id"]).toBe("pane_w1");
  });

  it("sem capacidade ⇒ unavailable/no_capacity e NENHUM Pane órfão; outros erros nominais viram rule_violation", async () => {
    const m = criarMundo();
    const semCapacidade = portaRota({}, { ok: false, erro: "no_capacity", mensagem: "Todas as contas estão esgotadas." });
    expect(await falha(spawn({}, semCapacidade, m))).toMatchObject({ code: "unavailable", subcode: "no_capacity" });
    expect(m.spawns).toHaveLength(0);
    expect(await falha(spawn({}, portaRota({}, { ok: false, erro: "unknown_task_type", mensagem: "?" }), m))).toMatchObject({ code: "rule_violation", subcode: "unknown_task_type" });
  });

  it("a rota passa pelas mesmas regras do MVP: worker não abre worker; provedor desabilitado é recusado", async () => {
    const m = criarMundo();
    m.deps.rota = portaRota({}, { ok: true, ...rotaPadrao, provedor: "gemini", cli: "gemini" });
    expect(await falha(spawn({}, undefined, m))).toMatchObject({ code: "rule_violation", subcode: "provider_disabled" });
    const worker = claimsDe({ mode: "agentico", role: "executor", mission_id: "mis_1", tools_allow: ["pane_spawn"] });
    m.deps.rota = portaRota();
    expect(await falha(IMPLEMENTACOES["pane_spawn"]({}, { claims: worker, deps: m.deps }))).toMatchObject({ subcode: "forbidden_role" });
  });

  it("RA-2: com agent_id e sem provider o roteador NÃO é acionado (o perfil do membro manda); route:auto explícito ainda roteia", async () => {
    const rota = portaRota();
    const { r, m } = await spawn({ agent_id: "eq.m1", role: "executor" }, rota);
    expect(r).toEqual({ pane_id: "pane_w1" });
    expect(rota.pedidos).toHaveLength(0);
    expect(rota.gravados).toHaveLength(0);
    expect(m.spawns[0]).toMatchObject({ agente_id: "eq.m1", papel: "executor" });
    const auto = portaRota();
    const { r: r2 } = await spawn({ agent_id: "eq.m1", route: "auto" }, auto);
    expect(auto.pedidos).toHaveLength(1);
    expect(r2["receipt"]).toBe(rotaPadrao.recibo);
  });

  it("falha ao gravar a rota não desfaz o Pane (aviso)", async () => {
    const { r, m } = await spawn({}, portaRota({ gravar: async () => Promise.reject(new Error("banco")) }));
    expect(r["pane_id"]).toBe("pane_w1");
    expect(m.avisos.join(" ")).toMatch(/rota do Pane não foi gravada/);
  });

  it("o schema anunciado não exige provider e declara route/task_type/task_description/faixa", () => {
    const s = DEFINICOES.pane_spawn.inputSchema;
    expect(s.required).toBeUndefined();
    expect(Object.keys(s.properties)).toEqual(expect.arrayContaining(["provider", "route", "task_type", "task_description", "faixa"]));
  });
});

describe("account_switch", () => {
  const resultado = { new_pane_id: "pane_novo", from: { conta_id: "conta_a", provedor: "claude", modelo: null }, to: { conta_id: "conta_b", provedor: "claude", modelo: "m" } };
  function troca(sobre: Partial<PortaTroca> = {}): PortaTroca & { pedidos: unknown[] } {
    const pedidos: unknown[] = [];
    return { pedidos, mover: async (p) => (pedidos.push(p), resultado), ...sobre };
  }
  function montar(t: PortaTroca | null = troca()) {
    const m = criarMundo();
    m.adicionarPane({ pane_id: "pane_w", papel: "executor" });
    if (t !== null) m.deps.troca = t;
    return m;
  }
  const chamar = (m: ReturnType<typeof montar>, args: unknown, claims = piloto()) => IMPLEMENTACOES["account_switch"](args as Record<string, unknown>, { claims, deps: m.deps }) as Promise<Record<string, any>>;

  it("só o piloto agêntico a vê no tools/list; squad, livre e workers não", () => {
    expect(ferramentasPermitidas("agentico", "piloto")).toContain("account_switch");
    expect(ferramentasPermitidas("squad", "piloto")).not.toContain("account_switch");
    expect(ferramentasPermitidas("livre", "nenhum")).not.toContain("account_switch");
    expect(ferramentasPermitidas("agentico", "executor")).toEqual(["handoff_submit"]);
    expect(TOOLS_HARNESS).toContain("account_switch");
  });

  it("move pelo mesmo caminho do botão e devolve { new_pane_id, from, to } no contrato externo", async () => {
    const t = troca();
    const r = await chamar(montar(t), { pane_id: "pane_w", target_account_id: "conta_b", reason: "limite", force: true });
    expect(r).toEqual({ new_pane_id: "pane_novo", from: { account_id: "conta_a", provider: "claude", model: null }, to: { account_id: "conta_b", provider: "claude", model: "m" } });
    expect(t.pedidos).toEqual([{ pane_id: "pane_w", target_account_id: "conta_b", reason: "limite", force: true }]);
  });

  it("sem force por padrão; destino e motivo opcionais", async () => {
    const t = troca();
    await chamar(montar(t), { pane_id: "pane_w" });
    expect(t.pedidos[0]).toEqual({ pane_id: "pane_w", target_account_id: null, reason: null, force: false });
  });

  it("forbidden_role para worker e squad (mesmo com token que a lista) e para o próprio piloto", async () => {
    const t = troca();
    const m = montar(t);
    const worker = claimsDe({ mode: "agentico", role: "executor", mission_id: "mis_1", pane_id: "pane_x", tools_allow: ["account_switch"] });
    const squad = claimsDe({ mode: "squad", role: "piloto", mission_id: "mis_1", tools_allow: ["account_switch"] });
    expect(await falha(chamar(m, { pane_id: "pane_w" }, worker))).toMatchObject({ code: "rule_violation", subcode: "forbidden_role" });
    expect(await falha(chamar(m, { pane_id: "pane_w" }, squad))).toMatchObject({ subcode: "forbidden_role" });
    expect(await falha(chamar(m, { pane_id: "pane_p" }))).toMatchObject({ subcode: "forbidden_role" });
    expect(t.pedidos).toHaveLength(0);
  });

  it("Pane de outra Missão ou inexistente: nada é movido", async () => {
    const t = troca();
    const m = montar(t);
    m.adicionarPane({ pane_id: "pane_alheio", mission_id: "mis_OUTRA" });
    expect(await falha(chamar(m, { pane_id: "pane_alheio" }))).toMatchObject({ code: "unauthorized" });
    expect(await falha(chamar(m, { pane_id: "pane_nao_existe" }))).toMatchObject({ code: "not_found" });
    expect(t.pedidos).toHaveLength(0);
  });

  it.each([
    ["rule_violation", "not_at_limit"],
    ["rule_violation", "provider_mismatch"],
    ["rule_violation", "limit_reached"],
    ["unavailable", "no_capacity"],
  ] as const)("erro nominal %s/%s chega intacto da porta", async (code, subcode) => {
    const m = montar(troca({ mover: async () => Promise.reject(new ErroMcp(code, "não pode", subcode)) }));
    expect(await falha(chamar(m, { pane_id: "pane_w" }))).toMatchObject({ code, subcode });
  });

  it("sem a porta ⇒ unavailable; erro desconhecido ⇒ unavailable sem detalhe interno", async () => {
    expect(await falha(chamar(montar(null), { pane_id: "pane_w" }))).toMatchObject({ code: "unavailable" });
    const m = montar(troca({ mover: async () => Promise.reject(new Error("detalhe interno do banco")) }));
    const e = await falha(chamar(m, { pane_id: "pane_w" }));
    expect(e.code).toBe("unavailable");
    expect(e.message).not.toContain("banco");
  });
});
