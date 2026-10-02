// Gate `pre-mcp` da Loja de MCPs nos hooks do Claude (Fase 7B, T-07B.22): settings por Pane e decisão do gancho.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUTO } from "../../produto";
import { MATCHER_MCP_LOJA, criarGanchosClaude, gerarSettingsDoPane, gerarSettingsSoGateLoja, type OpcoesSettingsPane } from "./claude";

const opcoes = (p: Partial<OpcoesSettingsPane> = {}): OpcoesSettingsPane => ({
  dirApp: "/app/dados", pane_id: "pane_w1", papel: "executor", nomeServidor: PRODUTO.id, executavelNode: "/usr/bin/node", script: "/app/gancho.mjs", variavelUrl: "X_URL", variavelToken: "X_TOKEN", ...p,
});
const comando = (h: { command: string }): string => h.command.split(" ")[2] as string;

describe("settings com o gate da Loja", () => {
  it("sem Loja nada muda (worker e piloto idênticos ao MVP)", () => {
    expect(JSON.parse(gerarSettingsDoPane(opcoes()).conteudo).hooks.PreToolUse).toBeUndefined();
    expect(JSON.parse(gerarSettingsDoPane(opcoes({ papel: "piloto" })).conteudo).hooks.PreToolUse).toHaveLength(1);
  });

  it("worker com Loja: PreToolUse só no matcher mcp__ev_.* → pre-mcp; piloto: guarda de escrita E gate, nessa ordem", () => {
    const w = JSON.parse(gerarSettingsDoPane(opcoes({ gateMcpLoja: true })).conteudo);
    expect(w.hooks.PreToolUse).toHaveLength(1);
    expect(w.hooks.PreToolUse[0].matcher).toBe(MATCHER_MCP_LOJA);
    expect(comando(w.hooks.PreToolUse[0].hooks[0])).toBe("pre-mcp");
    expect(w.hooks.Stop).toBeDefined();
    const p = JSON.parse(gerarSettingsDoPane(opcoes({ papel: "piloto", gateMcpLoja: true })).conteudo);
    expect(p.hooks.PreToolUse.map((x: { matcher: string }) => x.matcher)).toEqual(["Edit|Write|MultiEdit|NotebookEdit", MATCHER_MCP_LOJA]);
  });

  it("Pane livre: settings só com o gate, mesmo caminho e marcador; pane_id com traversal é recusado", () => {
    const s = gerarSettingsSoGateLoja({ dirApp: "/app/dados", pane_id: "pane_l", nomeServidor: PRODUTO.id, executavelNode: "/usr/bin/node", electronComoNode: true, script: "/app/gancho.mjs", variavelUrl: "X_URL", variavelToken: "X_TOKEN" });
    expect(s.caminho).toBe(join("/app/dados", "panes", "pane_l", "claude-settings.json"));
    const j = JSON.parse(s.conteudo);
    expect(j[`managed_by_${PRODUTO.id}`]).toBe(true);
    expect(Object.keys(j.hooks)).toEqual(["PreToolUse"]);
    expect(j.hooks.PreToolUse[0].hooks[0].command).toMatch(/^ELECTRON_RUN_AS_NODE=1 .* pre-mcp X_URL X_TOKEN$/);
    expect(() => gerarSettingsSoGateLoja({ dirApp: "/a", pane_id: "../x", nomeServidor: "n", executavelNode: "n", script: "s", variavelUrl: "u", variavelToken: "t" })).toThrow();
  });
});

describe("gancho pre-mcp", () => {
  const ctx = { workspace_id: "ws_1", mission_id: null, pane_id: "pane_1" };
  const base = { handoff: {} as never, fila: {} as never, contexto: async () => null, raiz: async () => "/r" };

  it("sem gate configurado NEGA (falha fechada)", async () => {
    const g = criarGanchosClaude({ ...base });
    const r = await g.tratar("pre-mcp", ctx, { tool_name: "mcp__ev_x__y" });
    expect(r.saida).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
  });

  it("permitido devolve vazio (a aprovação da CLI continua valendo: o hook NUNCA força allow); negado devolve deny com o motivo", async () => {
    const vistos: Array<[string, string]> = [];
    const g = criarGanchosClaude({
      ...base,
      gateMcp: (pane, ferramenta) => { vistos.push([pane, ferramenta]); return ferramenta === "mcp__ev_ok__eco" ? { permitido: true, motivo: null } : { permitido: false, motivo: "não habilitado" }; },
    });
    expect((await g.tratar("pre-mcp", ctx, { tool_name: "mcp__ev_ok__eco" })).saida).toBeNull();
    const negado = await g.tratar("pre-mcp", ctx, { tool_name: "mcp__ev_nao__x" });
    expect(negado.saida).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "não habilitado" } });
    expect(JSON.stringify(negado)).not.toContain('"allow"');
    expect(vistos).toEqual([["pane_1", "mcp__ev_ok__eco"], ["pane_1", "mcp__ev_nao__x"]]);
  });

  it("corpo sem tool_name ou malformado nunca lança: o gate decide com nome vazio", async () => {
    const g = criarGanchosClaude({ ...base, gateMcp: (_p, f) => ({ permitido: f !== "", motivo: null }) });
    expect((await g.tratar("pre-mcp", ctx, null)).saida).not.toBeNull();
    expect((await g.tratar("pre-mcp", ctx, { tool_name: 7 })).saida).not.toBeNull();
  });

  it("o script de gancho falha FECHADO em pre-mcp (como no guarda de escrita) e ficou fora do arquivo de outros eventos", () => {
    const fonte = readFileSync(join(__dirname, "scripts", "gancho.mjs"), "utf8");
    expect(fonte).toContain('const FALHA_FECHADA = evento === "pre-tool-use" || evento === "pre-mcp" || evento === "pre-skill";');
  });
});
