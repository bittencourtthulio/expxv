// Isolamento de skills/MCP de usuário nos hooks do Claude (Fase 7, T-07.21/22): settings por Pane e decisão dos ganchos `pre-skill`/`pre-mcp`.
import { describe, expect, it } from "vitest";
import { decidirGate, type SnapshotPane } from "../../catalogo/gate";
import { montarIsolamentoClaude } from "../../catalogo/isolamento/claude";
import { NIVEL_POR_CLI } from "../../catalogo/politica";
import { PRODUTO } from "../../produto";
import { MATCHER_MCP_LOJA, MATCHER_MCP_TODOS, MATCHER_SKILL, criarGanchosClaude, gerarSettingsDoPane, type OpcoesSettingsPane } from "./claude";

const opcoes = (p: Partial<OpcoesSettingsPane> = {}): OpcoesSettingsPane => ({
  dirApp: "/app/dados", pane_id: "pane_w1", papel: "executor", nomeServidor: PRODUTO.id, executavelNode: "/usr/bin/node", script: "/app/gancho.mjs", variavelUrl: "X_URL", variavelToken: "X_TOKEN", ...p,
});
const iso = () => montarIsolamentoClaude({ politica: { skills: ["a1"], faltando: [], mcp_do_usuario: "nenhum", servidores_mcp: [], isolamento: { ...NIVEL_POR_CLI } }, skillsConhecidas: ["a1", "b2"], servidoresUsuario: [], dirApp: "/app/dados", pane_id: "pane_w1", temPluginEfemero: false });
const comando = (h: { command: string }): string => h.command.split(" ")[2] as string;

describe("settings com isolamento", () => {
  it("política nula/inativa: settings idêntico ao de antes (sem permissions, sem pre-skill)", () => {
    const sem = gerarSettingsDoPane(opcoes()).conteudo;
    expect(gerarSettingsDoPane(opcoes({ isolamento: { ativo: false, deny: [], gateSkill: false, gateMcpAmplo: false, argumentos: [], excedente: 0 } })).conteudo).toBe(sem);
    expect(sem).not.toContain("permissions");
  });
  it("ativo: PreToolUse Skill→pre-skill e mcp__.*→pre-mcp (no lugar do matcher só da Loja) e permissions.deny", () => {
    const j = JSON.parse(gerarSettingsDoPane(opcoes({ gateMcpLoja: true, isolamento: iso() })).conteudo);
    const pre = j.hooks.PreToolUse as Array<{ matcher: string; hooks: Array<{ command: string }> }>;
    expect(pre.map((x) => x.matcher)).toEqual([MATCHER_SKILL, MATCHER_MCP_TODOS]);
    expect(pre.map((x) => comando(x.hooks[0] as never))).toEqual(["pre-skill", "pre-mcp"]);
    expect(pre.map((x) => x.matcher)).not.toContain(MATCHER_MCP_LOJA);
    expect(j.permissions.deny).toEqual(["Skill(b2)"]);
    expect(j.hooks.Stop).toBeDefined();
  });
  it("piloto: guarda de escrita é preservada, depois os gates", () => {
    const j = JSON.parse(gerarSettingsDoPane(opcoes({ papel: "piloto", isolamento: iso() })).conteudo);
    expect((j.hooks.PreToolUse as Array<{ matcher: string }>).map((x) => x.matcher)).toEqual(["Edit|Write|MultiEdit|NotebookEdit", MATCHER_SKILL, MATCHER_MCP_TODOS]);
  });
});

describe("ganchos pre-skill / pre-mcp com política", () => {
  const ctx = { workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_1" };
  const base = { handoff: {} as never, fila: {} as never, contexto: async () => null, raiz: async () => "/r" };
  const snap: SnapshotPane = { cli: "claude", nivel: "duro", skills: ["a1", "a2", "a3"], mcp_do_usuario: "nenhum", servidores_mcp: [] };
  const gatePolitica = (_p: string, tipo: "skill" | "mcp", nome: string) => decidirGate({ tipo, nome, snapshot: snap });

  it("3 skills permitidas, a 4ª bloqueada (evento skill.blocked); permitir NUNCA força allow", async () => {
    const eventos: Array<[string, unknown]> = [];
    const g = criarGanchosClaude({ ...base, gatePolitica, emitir: (t, p) => eventos.push([t, p]) });
    for (const s of ["a1", "a2", "a3"]) expect((await g.tratar("pre-skill", ctx, { tool_name: "Skill", tool_input: { skill: s } })).saida).toBeNull();
    const r = await g.tratar("pre-skill", ctx, { tool_name: "Skill", tool_input: { skill: "a4" } });
    expect(r.saida).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(JSON.stringify(r)).toContain("skill_not_allowed: a4");
    expect(eventos).toEqual([["skill.blocked", { pane_id: "pane_1", skill: "a4" }]]);
  });
  it("falha fechada: sem gate configurado, corpo sem skill, gate que lança", async () => {
    const semGate = criarGanchosClaude({ ...base });
    expect((await semGate.tratar("pre-skill", ctx, { tool_input: { skill: "a1" } })).saida).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    const g = criarGanchosClaude({ ...base, gatePolitica });
    expect((await g.tratar("pre-skill", ctx, {})).saida).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    const quebrado = criarGanchosClaude({ ...base, gatePolitica: () => { throw new Error("x"); } });
    expect((await quebrado.tratar("pre-skill", ctx, { tool_input: { skill: "a1" } })).saida).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect((await quebrado.tratar("pre-mcp", ctx, { tool_name: "mcp__github__x" })).saida).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });
  it("pre-mcp: MCP de usuário só pela política; a Loja continua com o gate próprio E com a política", async () => {
    const g = criarGanchosClaude({ ...base, gatePolitica, gateMcp: (_p, f) => ({ permitido: f === "mcp__ev_ok__x", motivo: "loja nega" }) });
    expect((await g.tratar("pre-mcp", ctx, { tool_name: "mcp__github__x" })).saida).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect((await g.tratar("pre-mcp", ctx, { tool_name: `mcp__${PRODUTO.id}__pane_list` })).saida).toBeNull();
    expect((await g.tratar("pre-mcp", ctx, { tool_name: "mcp__ev_ok__x" })).saida).toBeNull();
    expect(JSON.stringify(await g.tratar("pre-mcp", ctx, { tool_name: "mcp__ev_no__x" }))).toContain("loja nega");
  });
  it("pre-mcp só com o gate da Loja (sem política) continua como antes", async () => {
    const g = criarGanchosClaude({ ...base, gateMcp: () => ({ permitido: true, motivo: null }) });
    expect((await g.tratar("pre-mcp", ctx, { tool_name: "mcp__ev_ok__x" })).saida).toBeNull();
  });
});
