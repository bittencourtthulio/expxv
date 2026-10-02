// OpenRouter nas tools do MCP (Fase 9, T-09.28): `provider_list`/`model_list` com o provedor virtual, `pane_spawn {provider:"openrouter", cli?, model}`
// e os erros nominais. As portas são dublês: aqui se prova o CONTRATO externo; a validação real roda em `main/openrouter.test.ts`.
import { describe, expect, it } from "vitest";
import { claimsDe, criarMundo } from "../../../tests/fixtures/mcp/dubles";
import { DEFINICOES, ferramentasPermitidas } from "./catalogo";
import { ErroMcp } from "./erros";
import type { ProvedorInfo } from "./portas";
import { IMPLEMENTACOES } from "./tools/index";

const piloto = () => claimsDe({ mode: "agentico", role: "piloto", mission_id: "mis_1", tools_allow: [...ferramentasPermitidas("agentico", "piloto")] });
const OR_OK: ProvedorInfo = { provedor: "openrouter", cli: "opencode", contas: ["conta_or"], habilitado: true, clis: ["opencode", "aider"] };
const OR_SEM_CONSENTIMENTO: ProvedorInfo = { provedor: "openrouter", cli: "openrouter", contas: [], habilitado: false, clis: [], motivo_desabilitado: "openrouter_not_consented" };
const OR_SEM_MODELO: ProvedorInfo = { provedor: "openrouter", cli: "openrouter", contas: ["conta_or"], habilitado: false, clis: ["opencode"], motivo_desabilitado: "model_not_enabled" };

const chamar = (nome: "provider_list" | "model_list" | "pane_spawn", args: unknown, m = criarMundo()) =>
  IMPLEMENTACOES[nome](args as Record<string, unknown>, { claims: piloto(), deps: m.deps });
async function falha(p: Promise<unknown>): Promise<{ code: string; subcode?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return (e as ErroMcp).corpo();
  }
  throw new Error("não falhou");
}

describe("provider_list / model_list com o provedor virtual openrouter", () => {
  it("openrouter só aparece com consentimento e ≥ 1 modelo habilitado, e traz as CLIs compatíveis", async () => {
    const m = criarMundo();
    m.provedores.push(OR_OK);
    const lista = (await chamar("provider_list", {}, m)) as Array<Record<string, unknown>>;
    expect(lista.find((p) => p["provider"] === "openrouter")).toEqual({ provider: "openrouter", cli: "opencode", accounts: ["conta_or"], enabled: true, clis: ["opencode", "aider"] });
    expect(lista.find((p) => p["provider"] === "claude")).not.toHaveProperty("clis");
    for (const off of [OR_SEM_CONSENTIMENTO, OR_SEM_MODELO]) {
      const m2 = criarMundo();
      m2.provedores.push(off);
      expect(((await chamar("provider_list", {}, m2)) as Array<Record<string, unknown>>).some((p) => p["provider"] === "openrouter")).toBe(false);
    }
  });

  it("model_list do openrouter devolve só os habilitados com a faixa; sem consentimento ⇒ provider_disabled", async () => {
    const m = criarMundo();
    m.provedores.push(OR_OK);
    m.deps.provedores.modelos = async () => [{ modelo: "anthropic/claude-x", niveis_esforco: [], faixa: "topo" }];
    expect(await chamar("model_list", { provider: "openrouter" }, m)).toEqual([{ model: "anthropic/claude-x", effort_levels: [], faixa: "topo" }]);
    const m2 = criarMundo();
    m2.provedores.push(OR_SEM_CONSENTIMENTO);
    expect(await falha(chamar("model_list", { provider: "openrouter" }, m2))).toMatchObject({ code: "rule_violation", subcode: "provider_disabled" });
  });
});

describe("pane_spawn com provider openrouter", () => {
  it("o schema anuncia `cli`", () => {
    expect(Object.keys(DEFINICOES.pane_spawn.inputSchema.properties)).toContain("cli");
  });

  it("explícito: provider+cli+model chegam à porta (que lança com o adaptador); devolve só { pane_id } (comportamento do MVP)", async () => {
    const m = criarMundo();
    m.provedores.push(OR_OK);
    const r = await chamar("pane_spawn", { provider: "openrouter", cli: "aider", model: "anthropic/claude-x" }, m);
    expect(r).toEqual({ pane_id: "pane_w1" });
    expect(m.spawns[0]).toMatchObject({ provedor: "openrouter", cli: "aider", modelo: "anthropic/claude-x" });
  });

  it("sem `cli` o pedido leva `cli: null` (a porta escolhe a primeira compatível)", async () => {
    const m = criarMundo();
    m.provedores.push(OR_OK);
    await chamar("pane_spawn", { provider: "openrouter", model: "anthropic/claude-x" }, m);
    expect(m.spawns[0]).toMatchObject({ provedor: "openrouter", cli: null });
  });

  it("recusas nominais: sem consentimento, sem modelo habilitado e (via porta) modelo não habilitado/sem CLI compatível", async () => {
    const a = criarMundo();
    a.provedores.push(OR_SEM_CONSENTIMENTO);
    expect(await falha(chamar("pane_spawn", { provider: "openrouter", model: "a/b" }, a))).toMatchObject({ code: "rule_violation", subcode: "openrouter_not_consented" });
    const b = criarMundo();
    b.provedores.push(OR_SEM_MODELO);
    expect(await falha(chamar("pane_spawn", { provider: "openrouter", model: "a/b" }, b))).toMatchObject({ code: "rule_violation", subcode: "model_not_enabled" });
    expect(a.spawns).toHaveLength(0);
    expect(b.spawns).toHaveLength(0);
    for (const [erro, esperado] of [
      [new ErroMcp("rule_violation", "x", "model_not_enabled"), { code: "rule_violation", subcode: "model_not_enabled" }],
      [new ErroMcp("unavailable", "x", "no_compatible_cli"), { code: "unavailable", subcode: "no_compatible_cli" }],
    ] as const) {
      const m = criarMundo();
      m.provedores.push(OR_OK);
      m.deps.panes.spawn = async () => {
        throw erro;
      };
      expect(await falha(chamar("pane_spawn", { provider: "openrouter", model: "a/b" }, m))).toMatchObject(esperado);
    }
  });

  it("falha comum de infraestrutura continua `unavailable` genérica (sem vazar detalhe)", async () => {
    const m = criarMundo();
    m.provedores.push(OR_OK);
    m.falhaNoSpawn = true;
    const corpo = await falha(chamar("pane_spawn", { provider: "openrouter", model: "a/b" }, m));
    expect(corpo.code).toBe("unavailable");
    expect(corpo.message).not.toContain("boom");
  });

  it("`cli` só vale com provider openrouter; provedor nativo não leva `cli` no pedido", async () => {
    const m = criarMundo();
    expect(await falha(chamar("pane_spawn", { provider: "claude", cli: "opencode" }, m))).toMatchObject({ code: "invalid_argument" });
    await chamar("pane_spawn", { provider: "claude" }, m);
    expect(m.spawns[0]).not.toHaveProperty("cli");
  });
});
