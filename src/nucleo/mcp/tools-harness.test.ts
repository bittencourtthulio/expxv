// Tools da Fase 9 (T-09.17): harness_list, harness_recommend, harness_set, decisions_list, headline_limits, headline_pick.
// As portas são dublês: aqui se prova o CONTRATO externo (formato, erros, ≤ 4 KB, matriz); a escolha de conta real é provada em `main/harness.test.ts`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claimsDe, criarMundo } from "../../../tests/fixtures/mcp/dubles";
import { FAIXAS, PROPOSITOS_DECISAO, type Executor } from "../../compartilhado/harness";
import type { AccountUsage } from "../../compartilhado/limites";
import { ferramentasPermitidas } from "./catalogo";
import type { DecisaoInfo, PoliticaInfo, PortaHarness, PortaLimites } from "./portas";
import { FAIXAS_MCP, LIMITE_RESPOSTA_BYTES, PROPOSITOS_MCP } from "./tools/harness";
import { IMPLEMENTACOES } from "./tools/index";

const exec = (provider: string, faixa: Executor["faixa"] = "alto"): Executor => ({ provider, cli: provider, model: null, effort: null, faixa });
const politica = (slug: string, provider = "claude", categoria = "desenvolvimento"): PoliticaInfo => ({ task_type: slug, categoria, rotulo: slug, executor: exec(provider), alternativas: [exec("codex")], fallback: [exec(provider, "topo")], habilitada: true });

function portaHarness(sobre: Partial<PortaHarness> = {}): PortaHarness & { definidos: unknown[] } {
  const definidos: unknown[] = [];
  return {
    definidos,
    listar: async (_ws, cat) => [politica("implementar"), politica("auditar", "codex", "revisao")].filter((p) => cat === null || p.categoria === cat),
    recomendar: async () => ({ task_type: "bug-fix", confianca: 0.6, executor: exec("claude", "medio"), conta_id: "conta_a", fonte: "heuristica", recibo: "Conta a escolhida por regra.", erro: null }),
    definir: async (p) => {
      definidos.push(p);
      return { ok: true, politica: politica(p.task_type, p.provedor), avisos: [] };
    },
    pilotoEditaPolitica: async () => true,
    decisoes: async () => ({ decisoes: [], total: 0, custo_usd: null }),
    ...sobre,
  };
}
const uso = (id: string, usedPct: number | null): AccountUsage => ({
  account_id: id, provider: "claude", fetched_at: "2026-10-01T12:00:00.000Z", fonte: "claude_statusline", confianca: "medido", status: "ok",
  windows: [{ kind: "five_hour", used_pct: usedPct, resets_at: "2026-10-01T17:00:00.000Z" }], model_buckets: {}, bottleneck: usedPct === null ? null : "five_hour", slack_pct: usedPct === null ? null : 100 - usedPct, idade_s: 5, vencidas: [],
});
function portaLimites(sobre: Partial<PortaLimites> = {}): PortaLimites {
  return {
    limites: async (p) => ({ contas: [uso("conta_a", 40), uso("conta_b", null)].filter((c) => p === null || c.provider === p), geral: { pior: { conta_id: "conta_a", rotulo: "a", kind: "five_hour", used_pct: 40 }, folga_media_pct: 60, cobertura: { com_dado: 1, total: 2 }, em_alerta: 0, esgotadas: 0 } }),
    escolher: async () => ({ conta_id: "conta_a", folga_pct: 60, motivo: "reseta primeiro" }),
    ...sobre,
  };
}

function mundoCom(h: PortaHarness | undefined, l: PortaLimites | undefined, opcoes: Parameters<typeof criarMundo>[0] = {}) {
  const m = criarMundo(opcoes);
  if (h !== undefined) m.deps.harness = h;
  if (l !== undefined) m.deps.limites = l;
  return m;
}
const piloto = (extra: Parameters<typeof ferramentasPermitidas>[2] = {}) =>
  claimsDe({ mode: "agentico", role: "piloto", mission_id: "mis_1", tools_allow: [...ferramentasPermitidas("agentico", "piloto", extra)] });

async function chamar(nome: keyof typeof IMPLEMENTACOES, args: unknown, m = mundoCom(portaHarness(), portaLimites()), claims = piloto()) {
  return IMPLEMENTACOES[nome](args as Record<string, unknown>, { claims, deps: m.deps }) as Promise<Record<string, any>>;
}
async function falha(p: Promise<unknown>): Promise<{ code: string; subcode?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return (e as { corpo(): { code: string; subcode?: string; message: string } }).corpo();
  }
  throw new Error("não falhou");
}
const bytes = (o: unknown): number => Buffer.byteLength(JSON.stringify(o), "utf8");

describe("constantes locais do worker do MCP", () => {
  it("são IGUAIS às do contrato (o worker não carrega compartilhado/harness)", () => {
    expect([...FAIXAS_MCP]).toEqual([...FAIXAS]);
    expect([...PROPOSITOS_MCP]).toEqual([...PROPOSITOS_DECISAO]);
  });
  it("sem a porta no main, as tools respondem `unavailable` (sem vazar detalhe)", async () => {
    const m = mundoCom(undefined, undefined);
    expect(await falha(chamar("harness_list", {}, m))).toMatchObject({ code: "unavailable" });
    expect(await falha(chamar("headline_limits", {}, m))).toMatchObject({ code: "unavailable" });
  });
});

describe("harness_list", () => {
  it("devolve o formato do contrato e filtra por categoria", async () => {
    const r = await chamar("harness_list", {});
    expect(r["task_types"]).toHaveLength(2);
    expect(r["task_types"][0]).toEqual({ slug: "implementar", category: "desenvolvimento", label: "implementar", executor: exec("claude"), alternates: [exec("codex")], fallback: [exec("claude", "topo")], enabled: true });
    expect((await chamar("harness_list", { category: "revisao" }))["task_types"].map((t: { slug: string }) => t.slug)).toEqual(["auditar"]);
  });
  it("resposta ≤ 4 KB: corta a lista e marca truncated com o total", async () => {
    const muitos = Array.from({ length: 80 }, (_, i) => politica(`tipo-${i}`));
    const r = await chamar("harness_list", {}, mundoCom(portaHarness({ listar: async () => muitos }), portaLimites()));
    expect(bytes(r)).toBeLessThanOrEqual(LIMITE_RESPOSTA_BYTES);
    expect(r["truncated"]).toBe(true);
    expect(r["total"]).toBe(80);
    expect(r["task_types"].length).toBeGreaterThan(0);
  });
});

describe("harness_recommend", () => {
  it("devolve a recomendação sem criar Pane", async () => {
    const m = mundoCom(portaHarness(), portaLimites());
    const r = await chamar("harness_recommend", { task_description: "corrigir o botão de salvar" }, m);
    expect(r).toEqual({ task_type: "bug-fix", confidence: 0.6, executor: exec("claude", "medio"), account_id: "conta_a", source: "heuristic", receipt: "Conta a escolhida por regra." });
    expect(m.spawns).toHaveLength(0);
  });
  it("sem rota: rule_violation com o subcode nominal; entrada inválida: invalid_argument", async () => {
    const semRota = portaHarness({ recomendar: async () => ({ task_type: "geral", confianca: 0.3, executor: null, conta_id: null, fonte: "regra", recibo: "Sem capacidade agora.", erro: "no_capacity" }) });
    expect(await falha(chamar("harness_recommend", { task_description: "x" }, mundoCom(semRota, portaLimites())))).toMatchObject({ code: "rule_violation", subcode: "no_capacity" });
    expect((await falha(chamar("harness_recommend", {}))).code).toBe("invalid_argument");
    expect((await falha(chamar("harness_recommend", { task_description: "a".repeat(2001) }))).code).toBe("invalid_argument");
  });
});

describe("harness_set", () => {
  const pilotoComOptIn = () => piloto({ pilotoEditaPolitica: true });
  it("grava um override do workspace e devolve { policy }", async () => {
    const h = portaHarness();
    const r = await chamar("harness_set", { task_type: "bug-fix", provider: "codex", faixa: "medio", effort: "alto", fallback: [{ provider: "claude", faixa: "topo" }] }, mundoCom(h, portaLimites()), pilotoComOptIn());
    expect(r["policy"]).toMatchObject({ task_type: "bug-fix", enabled: true });
    expect(h.definidos[0]).toMatchObject({ workspace_id: "ws_1", pedido_por_pane_id: "pane_p", task_type: "bug-fix", provedor: "codex", faixa: "medio", esforco: "alto", fallback: [{ provider: "claude", cli: null, model: null, effort: null, faixa: "topo" }] });
  });
  it("sem o opt-in no workspace, mesmo com token antigo que a lista: forbidden_role (nada gravado)", async () => {
    const h = portaHarness({ pilotoEditaPolitica: async () => false });
    expect(await falha(chamar("harness_set", { task_type: "bug-fix", provider: "codex" }, mundoCom(h, portaLimites()), pilotoComOptIn()))).toMatchObject({ code: "rule_violation", subcode: "forbidden_role" });
    expect(h.definidos).toHaveLength(0);
  });
  it("squad e workers: forbidden_role", async () => {
    const h = portaHarness();
    const squad = claimsDe({ mode: "squad", role: "piloto", mission_id: "mis_1", tools_allow: ["harness_set"] });
    expect(await falha(chamar("harness_set", { task_type: "bug-fix", provider: "codex" }, mundoCom(h, portaLimites()), squad))).toMatchObject({ subcode: "forbidden_role" });
    const worker = claimsDe({ mode: "agentico", role: "executor", mission_id: "mis_1", tools_allow: ["harness_set"] });
    expect(await falha(chamar("harness_set", { task_type: "bug-fix", provider: "codex" }, mundoCom(h, portaLimites()), worker))).toMatchObject({ subcode: "forbidden_role" });
    expect(h.definidos).toHaveLength(0);
  });
  it.each(["executor_disabled", "invalid_effort", "unknown_task_type", "no_compatible_cli", "model_not_enabled"])("erro nominal %s vira rule_violation com o subcode", async (erro) => {
    const h = portaHarness({ definir: async () => ({ ok: false, erro, mensagem: "não pode" }) });
    expect(await falha(chamar("harness_set", { task_type: "bug-fix", provider: "codex" }, mundoCom(h, portaLimites()), pilotoComOptIn()))).toMatchObject({ code: "rule_violation", subcode: erro });
  });
  it("valida entrada: model e faixa juntos, faixa fora do conjunto, fallback vazio ou malformado", async () => {
    const m = mundoCom(portaHarness(), portaLimites());
    for (const args of [
      { task_type: "bug-fix", provider: "codex", model: "x", faixa: "topo" },
      { task_type: "bug-fix", provider: "codex", faixa: "supremo" },
      { task_type: "bug-fix", provider: "codex", fallback: [] },
      { task_type: "bug-fix", provider: "codex", fallback: [{ cli: "x" }] },
      { task_type: "bug-fix", provider: "codex", fallback: ["claude"] },
      { provider: "codex" },
    ]) expect((await falha(chamar("harness_set", args, m, pilotoComOptIn()))).code, JSON.stringify(args)).toBe("invalid_argument");
  });
});

describe("decisions_list", () => {
  const decisao = (i: number): DecisaoInfo => ({ id: `dec_${i}`, criado_em: "2026-10-01T12:00:00.000Z", proposito: "selecao_conta", escolhida: "claude|claude||||alto", fonte: "regra", recibo: "R".repeat(300), custo_usd: null });
  it("repassa filtros validados e traduz para o contrato (custo desconhecido = null)", async () => {
    let visto: unknown;
    const h = portaHarness({ decisoes: async (f) => ((visto = f), { decisoes: [decisao(1)], total: 1, custo_usd: null }) });
    const r = await chamar("decisions_list", { since: "2026-10-01T00:00:00Z", purpose: "troca", limit: 5 }, mundoCom(h, portaLimites()));
    expect(visto).toEqual({ workspace_id: "ws_1", desde: "2026-10-01T00:00:00Z", proposito: "troca", limite: 5 });
    expect(r["decisions"][0]).toMatchObject({ id: "dec_1", purpose: "selecao_conta", chosen: "claude|claude||||alto", source: "regra", cost_usd: null });
    expect(r["decisions"][0].receipt.length).toBeLessThanOrEqual(240);
    expect(r["totals"]).toEqual({ count: 1, cost_usd: null });
  });
  it("≤ 4 KB mesmo com 200 decisões", async () => {
    const h = portaHarness({ decisoes: async () => ({ decisoes: Array.from({ length: 200 }, (_, i) => decisao(i)), total: 200, custo_usd: 0.5 }) });
    const r = await chamar("decisions_list", { limit: 200 }, mundoCom(h, portaLimites()));
    expect(bytes(r)).toBeLessThanOrEqual(LIMITE_RESPOSTA_BYTES);
    expect(r["truncated"]).toBe(true);
    expect(r["totals"]).toEqual({ count: 200, cost_usd: 0.5 });
  });
  it("entrada inválida: since, purpose e limit", async () => {
    for (const args of [{ since: "ontem" }, { purpose: "x" }, { limit: 0 }, { limit: 201 }, { limit: 1.5 }]) expect((await falha(chamar("decisions_list", args))).code, JSON.stringify(args)).toBe("invalid_argument");
  });
});

describe("headline_limits", () => {
  it("forma compacta, dado desconhecido como null e cota geral; filtra por provedor", async () => {
    const r = await chamar("headline_limits", {});
    expect(r["accounts"]).toHaveLength(2);
    expect(r["accounts"][1]).toMatchObject({ account_id: "conta_b", slack_pct: null, bottleneck: null, windows: [{ kind: "five_hour", used_pct: null }] });
    expect(r["overall"]).toEqual({ worst: { account_id: "conta_a", kind: "five_hour", used_pct: 40 }, mean_slack_pct: 60, coverage: { with_data: 1, total: 2 }, alerting: 0, exhausted: 0 });
    expect((await chamar("headline_limits", { provider: "codex" }))["accounts"]).toEqual([]);
  });
  it("nunca carrega caminho nem chave e fica ≤ 4 KB com 60 contas", async () => {
    const contas = Array.from({ length: 60 }, (_, i) => uso(`conta_${i}`, i));
    const l = portaLimites({ limites: async () => ({ contas, geral: { pior: null, folga_media_pct: null, cobertura: { com_dado: 60, total: 60 }, em_alerta: 0, esgotadas: 0 } }) });
    const r = await chamar("headline_limits", {}, mundoCom(portaHarness(), l));
    expect(bytes(r)).toBeLessThanOrEqual(LIMITE_RESPOSTA_BYTES);
    expect(r["truncated"]).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/\/Users\/|config_dir|api[_-]?key|token/i);
  });
});

describe("headline_pick", () => {
  it("delega à porta (pickAccount) com a estratégia pedida e responde no contrato", async () => {
    let visto: unknown;
    const l = portaLimites({ escolher: async (p) => ((visto = p), { conta_id: "conta_a", folga_pct: 30, motivo: "maior folga" }) });
    const r = await chamar("headline_pick", { provider: "claude", window: "weekly", strategy: "max_slack", model: "opus" }, mundoCom(portaHarness(), l));
    expect(visto).toEqual({ workspace_id: "ws_1", provedor: "claude", janela: "weekly", estrategia: "max_slack", modelo: "opus" });
    expect(r).toEqual({ account_id: "conta_a", slack_pct: 30, reason: "maior folga", strategy: "max_slack" });
  });
  it("padrões: window auto e expires_first; slack desconhecido é null", async () => {
    let visto: any;
    const l = portaLimites({ escolher: async (p) => ((visto = p), { conta_id: "conta_a", folga_pct: null, motivo: "sem dado" }) });
    const r = await chamar("headline_pick", { provider: "claude" }, mundoCom(portaHarness(), l));
    expect(visto).toMatchObject({ janela: "auto", estrategia: "expires_first", modelo: null });
    expect(r).toMatchObject({ slack_pct: null, strategy: "expires_first" });
  });
  it("nenhuma conta disponível: unavailable/no_account_available", async () => {
    const l = portaLimites({ escolher: async () => null });
    expect(await falha(chamar("headline_pick", { provider: "claude" }, mundoCom(portaHarness(), l)))).toMatchObject({ code: "unavailable", subcode: "no_account_available" });
  });
  it("provedor desabilitado: provider_disabled; entrada inválida: invalid_argument", async () => {
    expect(await falha(chamar("headline_pick", { provider: "gemini" }))).toMatchObject({ code: "rule_violation", subcode: "provider_disabled" });
    for (const args of [{}, { provider: "claude", window: "daily" }, { provider: "claude", strategy: "aleatoria" }]) expect((await falha(chamar("headline_pick", args))).code, JSON.stringify(args)).toBe("invalid_argument");
  });
});

describe("não existe segunda implementação de escolha de conta", () => {
  const ler = (rel: string): string => readFileSync(join(__dirname, rel), "utf8");
  it("as tools do MCP não ordenam nem comparam contas: só traduzem a porta", () => {
    for (const f of ["tools/limites.ts", "tools/harness.ts"]) {
      const src = ler(f);
      expect(src, f).not.toMatch(/\.sort\(|used_pct\s*[<>]|slack_pct\s*[<>]|resets_at\s*[<>]/);
    }
  });
  it("a porta do main delega a `pickAccount` (única implementação) e `medirUso`", () => {
    const src = readFileSync(join(__dirname, "..", "..", "main", "harness.ts"), "utf8");
    expect(src).toMatch(/import \{[^}]*\bpickAccount\b[^}]*\} from "\.\.\/nucleo\/harness\/escolher-conta"/);
    expect(src).toMatch(/pickAccount\(candidatas, opcoes\)/);
  });
});
