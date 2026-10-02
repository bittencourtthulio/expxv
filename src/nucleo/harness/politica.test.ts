import { afterEach, describe, expect, it } from "vitest";
import type { AtualizadoPor, Executor, Politica, PoliticaEntrada } from "../../compartilhado/harness";
import { PADRAO } from "../../../tests/fixtures/harness/construtores";
import { abrirBanco, migrar, type Banco } from "../banco/index";
import { criarRepositorios } from "../banco/repos/index";
import { montarEquivalencia } from "./equivalencia";
import { candidatosDaPolitica, executorConcreto, gravarPolitica, politicaEfetiva, restaurarSemente, validarPolitica, type ContextoPolitica, type EventoPoliticaMudou } from "./politica";
import { gerarSemente } from "./semente";
import { TASK_TYPES_EMBUTIDOS } from "./task-types";

const ex = (provider: string, x: Partial<Executor> = {}): Executor => ({ provider, cli: provider === "openrouter" ? null : provider, model: null, effort: null, faixa: "alto", ...x });
const entrada = (x: Partial<PoliticaEntrada> = {}): PoliticaEntrada => ({ workspace_id: null, task_type: "bug-fix", executor: ex("claude"), alternativas: [ex("codex")], fallback: [ex("claude", { faixa: "topo" })], skills: [], agente: null, conta_fixa_id: null, evitar_reservadas: true, habilitada: true, ...x });
const ctx = (x: Partial<ContextoPolitica> = {}): ContextoPolitica => ({
  taskTypes: new Set(TASK_TYPES_EMBUTIDOS.map((t) => t.slug)),
  provedoresHabilitados: new Set(["claude", "codex"]),
  contasHabilitadas: new Map([["cta_1", "claude"]]),
  clisInstaladas: new Set(["claude", "codex"]),
  openrouter: { consentido: false, modelosHabilitados: new Set(), clisCompativeis: [] },
  esforcoDe: () => [],
  ...x,
});
const OR_OK = { consentido: true, modelosHabilitados: new Set(["v/m"]), clisCompativeis: ["opencode"] };

describe("validarPolitica: tabela de erros nominais", () => {
  const casos: Array<[string, PoliticaEntrada, Partial<ContextoPolitica>, string, string]> = [
    ["tipo desconhecido", entrada({ task_type: "inventado" }), {}, "unknown_task_type", "task_type"],
    ["fallback vazio", entrada({ fallback: [] }), {}, "fallback_obrigatorio", "fallback"],
    ["provedor do executor desabilitado", entrada({ executor: ex("gemini") }), {}, "executor_disabled", "executor.provider"],
    ["provedor de alternativa desabilitado", entrada({ alternativas: [ex("gemini")] }), {}, "executor_disabled", "alternativas[0].provider"],
    ["provedor do fallback desabilitado", entrada({ fallback: [ex("gemini", { faixa: "topo" })] }), {}, "executor_disabled", "fallback[0].provider"],
    ["conta fixada desabilitada", entrada({ conta_fixa_id: "cta_9" }), {}, "executor_disabled", "conta_fixa_id"],
    ["CLI diferente do provedor", entrada({ executor: ex("claude", { cli: "codex" }) }), {}, "no_compatible_cli", "executor.cli"],
    ["CLI não instalada", entrada(), { clisInstaladas: new Set(["codex"]) }, "no_compatible_cli", "executor.cli"],
    ["nome de modelo inválido", entrada({ executor: ex("claude", { model: "-x" }) }), {}, "invalid_model", "executor.model"],
    ["esforço fora dos níveis conhecidos", entrada({ executor: ex("claude", { effort: "xhigh" }) }), { esforcoDe: () => ["low", "high"] }, "invalid_effort", "executor.effort"],
    ["openrouter sem consentimento", entrada({ executor: ex("openrouter", { model: "v/m" }) }), { provedoresHabilitados: new Set(["claude", "openrouter"]) }, "openrouter_not_consented", "executor.provider"],
    ["openrouter com modelo não habilitado", entrada({ executor: ex("openrouter", { model: "v/outro" }) }), { provedoresHabilitados: new Set(["claude", "openrouter"]), openrouter: OR_OK }, "model_not_enabled", "executor.model"],
    ["openrouter sem modelo nem faixa", entrada({ executor: ex("openrouter", { faixa: null }) }), { provedoresHabilitados: new Set(["claude", "openrouter"]), openrouter: OR_OK }, "model_not_enabled", "executor.model"],
    ["openrouter sem CLI compatível", entrada({ executor: ex("openrouter", { model: "v/m" }) }), { provedoresHabilitados: new Set(["claude", "openrouter"]), openrouter: { ...OR_OK, clisCompativeis: [] } }, "no_compatible_cli", "executor.cli"],
    ["openrouter com CLI não compatível", entrada({ executor: ex("openrouter", { model: "v/m", cli: "aider" }) }), { provedoresHabilitados: new Set(["claude", "openrouter"]), openrouter: OR_OK }, "no_compatible_cli", "executor.cli"],
  ];
  it.each(casos)("%s", (_n, e, c, erro, campo) => {
    const r = validarPolitica(e, ctx(c));
    expect(r.ok).toBe(false);
    if (!r.ok) expect({ erro: r.erro, campo: r.campo }).toEqual({ erro, campo });
  });
  it("política válida passa e devolve a entrada normalizada", () => {
    const r = validarPolitica(entrada({ conta_fixa_id: "cta_1" }), ctx());
    expect(r.ok).toBe(true);
  });
  it("hoje todas as CLIs têm esforço vazio: effort vira null com aviso (não erro)", () => {
    const r = validarPolitica(entrada({ executor: ex("claude", { effort: "high" }) }), ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.politica.executor.effort).toBeNull();
      expect(r.avisos[0]).toMatch(/executor\.effort/);
    }
  });
  it("esforço dentro dos níveis conhecidos é mantido", () => {
    const r = validarPolitica(entrada({ executor: ex("claude", { effort: "high" }) }), ctx({ esforcoDe: () => ["low", "high"] }));
    expect(r.ok && r.politica.executor.effort).toBe("high");
  });
  it("aceita faixa no lugar de modelo e openrouter válido", () => {
    expect(validarPolitica(entrada({ executor: ex("openrouter", { model: "v/m", faixa: null }) }), ctx({ provedoresHabilitados: new Set(["claude", "codex", "openrouter"]), openrouter: OR_OK })).ok).toBe(true);
    expect(validarPolitica(entrada({ executor: ex("claude", { model: null, faixa: "medio" }) }), ctx()).ok).toBe(true);
  });
  it("não muta a entrada", () => {
    const e = entrada({ executor: ex("claude", { effort: "high" }) });
    const antes = JSON.stringify(e);
    validarPolitica(e, ctx());
    expect(JSON.stringify(e)).toBe(antes);
  });
});

describe("herança, candidatos e executor concreto", () => {
  const pol = (x: Partial<Politica>): Politica => ({ id: "pol_1", workspace_id: null, task_type: "bug-fix", executor: ex("claude"), alternativas: [ex("codex")], fallback: [ex("claude", { faixa: "topo" })], skills: [], agente: null, conta_fixa_id: null, evitar_reservadas: true, habilitada: true, atualizado_por: "usuario", atualizado_em: "", ...x });
  it("override do workspace vence a global", () => {
    const g = pol({ id: "g" });
    const w = pol({ id: "w", workspace_id: "ws1", executor: ex("codex") });
    expect(politicaEfetiva([g], [w], "bug-fix")?.id).toBe("w");
    expect(politicaEfetiva([g], [], "bug-fix")?.id).toBe("g");
    expect(politicaEfetiva([g], [w], "qa")).toBeUndefined();
  });
  it("override desabilitado herda a global; global desabilitada = nenhuma", () => {
    expect(politicaEfetiva([pol({ id: "g" })], [pol({ id: "w", habilitada: false })], "bug-fix")?.id).toBe("g");
    expect(politicaEfetiva([pol({ id: "g", habilitada: false })], [], "bug-fix")).toBeUndefined();
  });
  it("CT-9.06 política antiga com provedor depois desabilitado resolve pelo fallback", () => {
    const p = pol({ executor: ex("gemini"), alternativas: [ex("opencode")], fallback: [ex("claude", { faixa: "topo" })] });
    expect(candidatosDaPolitica(p, new Set(["claude", "codex"])).map((e) => e.provider)).toEqual(["claude"]);
  });
  it("ordem executor → alternativas → fallback, sem duplicatas, respeitando excluir_provedores", () => {
    const p = pol({ alternativas: [ex("codex"), ex("codex")], fallback: [ex("claude")] });
    expect(candidatosDaPolitica(p, new Set(["claude", "codex"])).map((e) => e.provider)).toEqual(["claude", "codex"]);
    expect(candidatosDaPolitica(p, new Set(["claude", "codex"]), { excluirProvedores: ["claude"] }).map((e) => e.provider)).toEqual(["codex"]);
    expect(candidatosDaPolitica(pol({ habilitada: false }), new Set(["claude"]))).toEqual([]);
  });
  it("openrouter só com consentimento", () => {
    const p = pol({ alternativas: [ex("openrouter", { model: "v/m" })] });
    const hab = new Set(["claude", "openrouter"]);
    expect(candidatosDaPolitica(p, hab).map((e) => e.provider)).toEqual(["claude", "claude"]);
    expect(candidatosDaPolitica(p, hab, { openrouterConsentido: true }).map((e) => e.provider)).toEqual(["claude", "openrouter", "claude"]);
  });
  it("executorConcreto: faixa → modelo da tabela; default → null; modelo explícito mantém", () => {
    expect(executorConcreto(ex("claude", { faixa: "topo" }), PADRAO)).toMatchObject({ model: "opus", faixa: "topo" });
    expect(executorConcreto(ex("claude", { faixa: "rapido" }), PADRAO)).toMatchObject({ model: "haiku" });
    expect(executorConcreto(ex("codex", { faixa: "topo" }), PADRAO)).toMatchObject({ model: null, faixa: "topo" });
    expect(executorConcreto(ex("claude", { model: "sonnet", faixa: null }), PADRAO)).toMatchObject({ model: "sonnet", faixa: "alto" });
    expect(executorConcreto(ex("claude", { faixa: null }), PADRAO)).toMatchObject({ model: null, faixa: null });
    const alterada = montarEquivalencia(PADRAO, { claude: { topo: [{ modelo: "sonnet", esforco: null }] } }).efetiva;
    expect(executorConcreto(ex("claude", { faixa: "topo" }), alterada).model).toBe("sonnet");
  });
});

describe("gravarPolitica e restaurarSemente (banco real)", () => {
  const abertos: Banco[] = [];
  afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
  function novo() {
    const b = abrirBanco(":memory:");
    abertos.push(b);
    migrar(b);
    const r = criarRepositorios(b);
    r.taskType.semear([...TASK_TYPES_EMBUTIDOS]);
    const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
    return { r, ws };
  }
  it("provedor desabilitado ⇒ erro nominal e NADA gravado, sem evento", () => {
    const { r } = novo();
    const eventos: EventoPoliticaMudou[] = [];
    const res = gravarPolitica(r.politica, entrada({ executor: ex("gemini") }), "usuario", ctx(), (e) => eventos.push(e));
    expect(res).toMatchObject({ ok: false, erro: "executor_disabled" });
    expect(r.politica.listar(null)).toHaveLength(0);
    expect(eventos).toEqual([]);
  });
  it("válida: grava, devolve avisos e emite policy.changed", () => {
    const { r } = novo();
    const eventos: EventoPoliticaMudou[] = [];
    const res = gravarPolitica(r.politica, entrada({ executor: ex("claude", { effort: "high" }) }), "mcp", ctx(), (e) => eventos.push(e));
    expect(res.ok).toBe(true);
    expect(r.politica.obter(null, "bug-fix")?.executor.effort).toBeNull();
    expect(eventos).toEqual([{ task_type: "bug-fix", por: "mcp" satisfies AtualizadoPor }]);
  });
  it("override por workspace vence a global; restaurar no workspace volta a herdar", () => {
    const { r, ws } = novo();
    gravarPolitica(r.politica, entrada(), "usuario", ctx());
    gravarPolitica(r.politica, entrada({ workspace_id: ws.id, executor: ex("codex") }), "usuario", ctx());
    expect(r.politica.efetiva(ws.id, "bug-fix")?.executor.provider).toBe("codex");
    expect(restaurarSemente(r.politica, ws.id, [], "bug-fix")).toBe(1);
    expect(r.politica.efetiva(ws.id, "bug-fix")?.executor.provider).toBe("claude");
  });
  it("restaurar a semente global apaga e regrava como 'semente'", () => {
    const { r } = novo();
    gravarPolitica(r.politica, entrada({ executor: ex("codex") }), "usuario", ctx());
    const semente = gerarSemente(["claude", "codex"], ["claude", "codex"], PADRAO);
    const eventos: EventoPoliticaMudou[] = [];
    expect(restaurarSemente(r.politica, null, semente, undefined, (e) => eventos.push(e))).toBe(TASK_TYPES_EMBUTIDOS.length);
    const p = r.politica.obter(null, "bug-fix") as Politica;
    expect(p.atualizado_por).toBe("semente");
    expect(p.executor.provider).toBe("claude");
    expect(eventos).toHaveLength(TASK_TYPES_EMBUTIDOS.length);
    // restaurar só um tipo
    gravarPolitica(r.politica, entrada({ executor: ex("codex") }), "usuario", ctx());
    expect(restaurarSemente(r.politica, null, semente, "bug-fix")).toBe(1);
    expect(r.politica.obter(null, "bug-fix")?.executor.provider).toBe("claude");
    expect(r.politica.listar(null)).toHaveLength(TASK_TYPES_EMBUTIDOS.length);
  });
});
