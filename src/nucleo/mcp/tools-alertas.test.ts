// Tool `alert_raise` (Fase 20, T-20.15): contrato externo, matriz por modo/papel (opt-in do token), identidade só do token, limites e resposta mínima.
// A porta é um dublê; a lógica real (limite de 3/hora, redação, `agente_mensagem` só no app) é de `alertas/alert-raise.test.ts` e `main/alertas.test.ts`.
import { describe, expect, it } from "vitest";
import { claimsDe, criarMundo } from "../../../tests/fixtures/mcp/dubles";
import { DEFINICOES, TOOLS_ALERTAS, TOOLS_MVP, ferramentasPermitidas } from "./catalogo";
import { ErroMcp, violacaoDeRegra } from "./erros";
import type { PortaAlertasMcp } from "./portas";
import { criarEmissorDeTokens } from "./tokens";
import { IMPLEMENTACOES } from "./tools/index";

function porta(sobre: Partial<PortaAlertasMcp> = {}): PortaAlertasMcp & { chamadas: Array<{ claims: unknown; args: unknown }> } {
  const chamadas: Array<{ claims: unknown; args: unknown }> = [];
  return { chamadas, levantar: async (claims, args) => (chamadas.push({ claims, args }), { alert_id: "alt_1", queued: true }), ...sobre };
}
const piloto = () => claimsDe({ mode: "agentico", role: "piloto", mission_id: "mis_1", pane_id: "pane_do_token", workspace_id: "ws_do_token", tools_allow: [...ferramentasPermitidas("agentico", "piloto", { alertas: "piloto" })] });
async function chamar(args: unknown, p: PortaAlertasMcp | null = porta()) {
  const m = criarMundo();
  if (p !== null) m.deps.alertas = p;
  return IMPLEMENTACOES.alert_raise(args as Record<string, unknown>, { claims: piloto(), deps: m.deps }) as Promise<Record<string, unknown>>;
}
async function falha(p: Promise<unknown>): Promise<{ code: string; subcode?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return (e as ErroMcp).corpo();
  }
  throw new Error("não falhou");
}

describe("catálogo e matriz (opt-in do token)", () => {
  it("a tool existe, com definição coerente e só `kind` e `title` obrigatórios", () => {
    expect([...TOOLS_ALERTAS]).toEqual(["alert_raise"]);
    expect(TOOLS_MVP).toContain("alert_raise");
    expect(DEFINICOES.alert_raise.name).toBe("alert_raise");
    expect(DEFINICOES.alert_raise.inputSchema.required).toEqual(["kind", "title"]);
  });
  it("sem opt-in ninguém a vê (padrão seguro)", () => {
    for (const modo of ["livre", "squad", "agentico"] as const) for (const papel of ["piloto", "nenhum", "executor", "explorador", "revisor"] as const) expect(ferramentasPermitidas(modo, papel)).not.toContain("alert_raise");
  });
  it("`piloto`: só o piloto vê; Pane livre e workers não", () => {
    for (const modo of ["squad", "agentico"] as const) expect(ferramentasPermitidas(modo, "piloto", { alertas: "piloto" })).toContain("alert_raise");
    for (const papel of ["nenhum", "executor", "explorador", "revisor"] as const) expect(ferramentasPermitidas("agentico", papel, { alertas: "piloto" })).not.toContain("alert_raise");
  });
  it("`todos` (opt-in do workspace): workers veem só handoff_submit + alert_raise", () => {
    for (const papel of ["executor", "explorador", "revisor"] as const) expect([...ferramentasPermitidas("agentico", papel, { alertas: "todos" })].sort()).toEqual(["alert_raise", "handoff_submit"]);
  });
  it("o token só inclui a tool com `alertas` na emissão", () => {
    const e = criarEmissorDeTokens({ segredo: Buffer.alloc(32, 7) });
    const base = { workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_a", role: "piloto" as const, mode: "agentico" as const };
    const com = e.verificar(e.emitir({ ...base, alertas: "piloto" }));
    const sem = e.verificar(e.emitir({ ...base, pane_id: "pane_b" }));
    expect(com?.tools_allow).toContain("alert_raise");
    expect(sem?.tools_allow).not.toContain("alert_raise");
    const worker = e.verificar(e.emitir({ ...base, role: "executor", pane_id: "pane_w", alertas: "piloto" }));
    expect(worker?.tools_allow).toEqual(["handoff_submit"]);
  });
});

describe("alert_raise", () => {
  it("encaminha só o contrato; identidade vem do TOKEN (campos de identidade nos argumentos são ignorados)", async () => {
    const p = porta();
    const r = await chamar({ kind: "attention", title: "  Preciso de uma decisão ", detail: "qual banco?", task_id: "T-1.2", pane_id: "pane_forjado", workspace_id: "ws_forjado", mission_id: "mis_forjada" }, p);
    expect(r).toEqual({ alert_id: "alt_1", queued: true });
    expect(p.chamadas).toHaveLength(1);
    expect(p.chamadas[0]?.claims).toMatchObject({ pane_id: "pane_do_token", workspace_id: "ws_do_token", mission_id: "mis_1", role: "piloto" });
    expect(p.chamadas[0]?.args).toEqual({ kind: "attention", title: "Preciso de uma decisão", detail: "qual banco?", task_id: "T-1.2" });
  });
  it("valida kind, tamanhos e task_id", async () => {
    expect((await falha(chamar({ kind: "urgente", title: "x" }))).code).toBe("invalid_argument");
    expect((await falha(chamar({ kind: "info", title: "x".repeat(81) }))).code).toBe("invalid_argument");
    expect((await falha(chamar({ kind: "info", title: "ok", detail: "d".repeat(281) }))).code).toBe("invalid_argument");
    expect((await falha(chamar({ kind: "info", title: "ok", task_id: "../etc" }))).code).toBe("invalid_argument");
    expect((await falha(chamar({ kind: "info" }))).code).toBe("invalid_argument");
  });
  it("sem a porta: unavailable; erro nominal da porta passa intacto; erro desconhecido vira unavailable sem vazar", async () => {
    expect((await falha(chamar({ kind: "info", title: "x" }, null))).code).toBe("unavailable");
    const taxa = porta({ levantar: async () => { throw violacaoDeRegra("limit_reached", "taxa"); } });
    expect(await falha(chamar({ kind: "info", title: "x" }, taxa))).toMatchObject({ code: "rule_violation", subcode: "limit_reached" });
    const estranho = porta({ levantar: async () => { throw new Error("SQLITE_ERROR /Users/x/.db segredo"); } });
    const c = await falha(chamar({ kind: "info", title: "x" }, estranho));
    expect(c.code).toBe("unavailable");
    expect(JSON.stringify(c)).not.toContain("SQLITE");
  });
});
