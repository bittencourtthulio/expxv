import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { claimsDe, criarMundo } from "../../../tests/fixtures/mcp/dubles";
import { PRODUTO } from "../produto";
import { ferramentasPermitidas } from "./catalogo";
import { IMPLEMENTACOES } from "./tools/index";

const claimsPiloto = (modo: "livre" | "squad" | "agentico" = "agentico") =>
  claimsDe({ mode: modo, role: modo === "livre" ? "nenhum" : "piloto", mission_id: modo === "livre" ? null : "mis_1", tools_allow: [...ferramentasPermitidas(modo, modo === "livre" ? "nenhum" : "piloto")] });

async function chamar(nome: keyof typeof IMPLEMENTACOES, args: unknown, mundo = criarMundo(), claims = claimsPiloto()) {
  return IMPLEMENTACOES[nome](args as Record<string, unknown>, { claims, deps: mundo.deps });
}
async function falha(p: Promise<unknown>): Promise<{ code: string; subcode?: string; message: string }> {
  try { await p; } catch (e) { return (e as { corpo(): { code: string; subcode?: string; message: string } }).corpo(); }
  throw new Error("não falhou");
}

describe("provider_list / model_list", () => {
  it("só provedores habilitados, no formato do contrato", async () => {
    const r = (await chamar("provider_list", {})) as Array<Record<string, unknown>>;
    expect(r.map((x) => x["provider"])).toEqual(["claude", "codex"]);
    expect(r[0]).toEqual({ provider: "claude", cli: "claude", accounts: ["conta_a"], enabled: true });
  });
  it("model_list de provedor desabilitado → provider_disabled; habilitado devolve effort_levels", async () => {
    expect(await falha(chamar("model_list", { provider: "gemini" }))).toMatchObject({ code: "rule_violation", subcode: "provider_disabled" });
    expect(await chamar("model_list", { provider: "claude" })).toEqual([{ model: "claude-modelo", effort_levels: ["baixo", "alto"] }]);
  });
  it("model_list marca o modelo padrão da CLI com default: true", async () => {
    const mundo = criarMundo();
    mundo.deps.provedores.modelos = async () => [{ modelo: "default", padrao: true, niveis_esforco: [] }, { modelo: "opus", niveis_esforco: [] }];
    expect(await chamar("model_list", { provider: "claude" }, mundo)).toEqual([
      { model: "default", effort_levels: [], default: true },
      { model: "opus", effort_levels: [] },
    ]);
  });
  it("valida entrada campo a campo", async () => {
    expect((await falha(chamar("model_list", {}))).code).toBe("invalid_argument");
    expect((await falha(chamar("model_list", { provider: 3 }))).code).toBe("invalid_argument");
    expect((await falha(chamar("model_list", [] as never))).code).toBe("invalid_argument");
  });
});

describe("pane_spawn", () => {
  it("devolve SÓ { pane_id } e o worker herda mission_id e papel do token/pedido", async () => {
    const m = criarMundo();
    const r = await chamar("pane_spawn", { provider: "codex", role: "executor", briefing_path: "b.md", mission_id: "mis_OUTRA", pane_id: "x", role_token: "y" }, m);
    expect(Object.keys(r as object)).toEqual(["pane_id"]);
    expect(m.spawns[0]).toMatchObject({ mission_id: "mis_1", workspace_id: "ws_1", papel: "executor", provedor: "codex", briefing_path: "b.md", pedido_por_pane_id: "pane_p" });
  });
  it("erros do contrato (gate, papel, limite, provedor)", async () => {
    const semGate = criarMundo({ portoes: ["direction"] });
    expect(await falha(chamar("pane_spawn", { provider: "claude" }, semGate))).toMatchObject({ code: "rule_violation", subcode: "gate_pending" });
    const m = criarMundo();
    expect(await falha(chamar("pane_spawn", { provider: "claude", role: "orchestrator" }, m))).toMatchObject({ subcode: "forbidden_role" });
    expect(await falha(chamar("pane_spawn", { provider: "gemini" }, m))).toMatchObject({ subcode: "provider_disabled" });
    for (let i = 0; i < 8; i++) await chamar("pane_spawn", { provider: "claude" }, m);
    expect(await falha(chamar("pane_spawn", { provider: "claude" }, m))).toMatchObject({ subcode: "limit_reached" });
  });
  it("role inválido e conta de outro provedor → invalid_argument; falha de infra → unavailable sem vazar detalhe", async () => {
    const m = criarMundo();
    expect((await falha(chamar("pane_spawn", { provider: "claude", role: "rei" }, m))).code).toBe("invalid_argument");
    expect((await falha(chamar("pane_spawn", { provider: "claude", account_id: "conta_z" }, m))).code).toBe("invalid_argument");
    m.falhaNoSpawn = true;
    const e = await falha(chamar("pane_spawn", { provider: "claude" }, m));
    expect(e.code).toBe("unavailable");
    expect(e.message).not.toContain("boom");
  });
  it("aviso (não erro) quando o revisor usa o provedor do executor", async () => {
    const m = criarMundo();
    m.adicionarPane({ pane_id: "w_exec", provedor: "claude", papel: "executor" });
    await chamar("pane_spawn", { provider: "claude", role: "reviewer" }, m);
    expect(m.avisos).toHaveLength(1);
  });
});

describe("pane_list / pane_read / pane_send / pane_close", () => {
  it("pane_list não traz conteúdo de tela e usa o vocabulário externo", async () => {
    const m = criarMundo();
    m.adicionarPane({ pane_id: "w1", task_id: "t1", papel: "explorador", estado: "aguardando" });
    const r = (await chamar("pane_list", {}, m)) as Array<Record<string, unknown>>;
    const w = r.find((x) => x["pane_id"] === "w1");
    expect(w).toEqual({ pane_id: "w1", provider: "claude", role: "scout", state: "awaiting_user", task_id: "t1" });
    expect(JSON.stringify(r)).not.toContain("linhas");
  });
  it("pane_list de outra Missão → not_in_mission", async () => {
    expect(await falha(chamar("pane_list", { mission_id: "mis_2" }))).toMatchObject({ subcode: "not_in_mission" });
  });
  it("pane_read: padrão 200, last_n:100 de 500 linhas devolve 100, teto 2000", async () => {
    const m = criarMundo();
    const w = m.adicionarPane({ pane_id: "w1" });
    (w as unknown as { linhas: string[] }).linhas = Array.from({ length: 5000 }, (_, i) => `l${i}`);
    expect(((await chamar("pane_read", { pane_id: "w1" }, m)) as { lines: string[] }).lines).toHaveLength(200);
    const cem = (await chamar("pane_read", { pane_id: "w1", last_n: 100 }, m)) as { lines: string[]; state: string };
    expect(cem.lines).toHaveLength(100);
    expect(cem.lines.at(-1)).toBe("l4999");
    expect(cem.state).toBe("working");
    expect(((await chamar("pane_read", { pane_id: "w1", last_n: 5000 }, m)) as { lines: string[] }).lines).toHaveLength(2000);
    expect((await falha(chamar("pane_read", { pane_id: "w1", last_n: 0 }, m))).code).toBe("invalid_argument");
  });
  it("pane inexistente → not_found; pane de outra Missão/workspace → unauthorized", async () => {
    const m = criarMundo();
    m.adicionarPane({ pane_id: "alheio", mission_id: "mis_2" });
    m.adicionarPane({ pane_id: "outro_ws", workspace_id: "ws_2" });
    expect((await falha(chamar("pane_read", { pane_id: "nada" }, m))).code).toBe("not_found");
    expect((await falha(chamar("pane_read", { pane_id: "alheio" }, m))).code).toBe("unauthorized");
    expect((await falha(chamar("pane_send", { pane_id: "outro_ws", text: "oi" }, m))).code).toBe("unauthorized");
    expect((await falha(chamar("pane_close", { pane_id: "alheio" }, m))).code).toBe("unauthorized");
  });
  it("pane_send: submit padrão true; texto pequeno vai direto", async () => {
    const m = criarMundo();
    m.adicionarPane({ pane_id: "w1" });
    expect(await chamar("pane_send", { pane_id: "w1", text: "oi" }, m)).toEqual({ accepted: true });
    await chamar("pane_send", { pane_id: "w1", text: "sem enter", submit: false }, m);
    expect(m.enviados).toEqual([{ pane_id: "w1", texto: "oi", submeter: true }, { pane_id: "w1", texto: "sem enter", submeter: false }]);
    expect((await falha(chamar("pane_send", { pane_id: "w1", text: "" }, m))).code).toBe("invalid_argument");
    expect((await falha(chamar("pane_send", { pane_id: "w1", text: "x", submit: "sim" }, m))).code).toBe("invalid_argument");
  });
  it("pane_send: texto > 20 KB vira arquivo na pasta do produto e envia o caminho", async () => {
    const m = criarMundo();
    m.adicionarPane({ pane_id: "w1" });
    const grande = "a".repeat(20 * 1024 + 1);
    await chamar("pane_send", { pane_id: "w1", text: grande }, m);
    const enviado = m.enviados[0]?.texto ?? "";
    expect(enviado.length).toBeLessThan(500);
    const caminho = /gravado em (\S+)\./.exec(enviado)?.[1] ?? "";
    expect(caminho).toContain(`${PRODUTO.pastaNoProjeto}/entradas/`);
    expect(existsSync(caminho)).toBe(true);
    expect(readFileSync(caminho, "utf8")).toBe(grande);
    expect(readFileSync(`${m.raiz}/${PRODUTO.pastaNoProjeto}/.gitignore`, "utf8")).toBe("*\n");
  });
  it("pane_send muito grande → too_large", async () => {
    const m = criarMundo();
    m.adicionarPane({ pane_id: "w1" });
    expect((await falha(chamar("pane_send", { pane_id: "w1", text: "a".repeat(600 * 1024) }, m))).code).toBe("too_large");
  });
  it("pane_close fecha worker, nunca o piloto", async () => {
    const m = criarMundo();
    m.adicionarPane({ pane_id: "w1" });
    expect(await chamar("pane_close", { pane_id: "w1" }, m)).toEqual({ ok: true });
    expect(await falha(chamar("pane_close", { pane_id: "pane_p" }, m))).toMatchObject({ subcode: "forbidden_role" });
  });
});

describe("mission_list / mission_complete", () => {
  it("lista com vocabulário externo e filtra por status", async () => {
    const m = criarMundo();
    expect(await chamar("mission_list", {}, m)).toEqual([{ mission_id: "mis_1", title: "Missão de teste", mode: "agentic", status: "running", pilot_pane_id: "pane_p" }]);
    expect(await chamar("mission_list", { status: "done" }, m)).toEqual([]);
    expect((await falha(chamar("mission_list", { status: "xx" }, m))).code).toBe("invalid_argument");
  });
  it("mission_complete sem revisor ok → reviewer_required; com revisor ok conclui a Missão do TOKEN", async () => {
    const m = criarMundo();
    expect(await falha(chamar("mission_complete", {}, m))).toMatchObject({ code: "rule_violation", subcode: "reviewer_required" });
    m.revisorOk = true;
    expect(await chamar("mission_complete", { mission_id: "mis_OUTRA" }, m)).toEqual({ ok: true });
    expect(m.concluidas).toEqual(["mis_1"]);
  });
});

describe("handoff_submit e catalog_list", () => {
  const valido = { task_id: "t1", summary: "feito", report_path: "r.md", status: "ok" };
  it("resumo > 400 → invalid_argument/summary_too_long; 400 passa", async () => {
    const m = criarMundo();
    const c = claimsDe({ role: "executor", pane_id: "w1" });
    expect(await falha(chamar("handoff_submit", { ...valido, summary: "x".repeat(401) }, m, c))).toMatchObject({ code: "invalid_argument", subcode: "summary_too_long" });
    await chamar("handoff_submit", { ...valido, summary: "x".repeat(400) }, m, c);
    expect(m.registros).toHaveLength(1);
  });
  it("identidade vem do token: pane_id/mission_id/role do argumento são ignorados; status traduzido", async () => {
    const m = criarMundo();
    const c = claimsDe({ role: "revisor", pane_id: "w9" });
    await chamar("handoff_submit", { ...valido, status: "partial", artifacts: ["a.txt"], pane_id: "pane_p", mission_id: "mis_X", role: "piloto" }, m, c);
    expect(m.registros[0]).toMatchObject({ pane_id: "w9", mission_id: "mis_1", papel: "revisor", status: "parcial", artefatos: ["a.txt"], workspace_id: "ws_1" });
  });
  it("validação campo a campo", async () => {
    const m = criarMundo();
    const c = claimsDe({ role: "executor", pane_id: "w1" });
    for (const ruim of [{ ...valido, task_id: undefined }, { ...valido, summary: "" }, { ...valido, report_path: 3 }, { ...valido, status: "done" }, { ...valido, artifacts: "a" }, { ...valido, artifacts: [1] }]) {
      expect((await falha(chamar("handoff_submit", ruim, m, c))).code).toBe("invalid_argument");
    }
  });
  it("catalog_list sem porta de catálogo devolve página vazia, mas valida kind e limites", async () => {
    expect(await chamar("catalog_list", { kind: "skill" })).toEqual({ items: [], next_cursor: null, truncated: false });
    expect((await falha(chamar("catalog_list", {}))).code).toBe("invalid_argument");
    expect((await falha(chamar("catalog_list", { kind: "tool" }))).code).toBe("invalid_argument");
    expect((await falha(chamar("catalog_list", { kind: "skill", limit: 101 }))).code).toBe("invalid_argument");
    expect((await falha(chamar("catalog_list", { kind: "skill", query: "x".repeat(101) }))).code).toBe("invalid_argument");
  });
});
