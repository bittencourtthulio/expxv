// T-16.28 · Fragmento de hooks do Maestro, soma com outros hooks (RAG, Loja) e elegibilidade do Pane.
import { describe, expect, it } from "vitest";
import { PRODUTO } from "../../produto";
import { criarGanchosClaude, gerarSettingsDoPane, gerarSettingsSoGateLoja, gerarSettingsSoMaestro, MARCADOR_GERENCIADO } from "../../orquestracao/hooks/claude";
import { fragmentoDeHooksDoMaestro, juntarHooksDoClaude, painelElegivel, TIMEOUT_DO_HOOK_S } from "./settings";

const opc = { executavelNode: "/usr/bin/node", script: "/app/hooks/scripts/maestro-prompt.mjs", variavelUrl: "X_URL", variavelToken: "X_TOKEN" };

describe("fragmento do hook", () => {
  it("UserPromptSubmit com o script, variáveis por NOME (nunca valor em argv) e timeout curto", () => {
    const f = fragmentoDeHooksDoMaestro(opc);
    const cmd = ((f["UserPromptSubmit"]![0] as { hooks: Array<{ command: string; timeout: number; type: string }> }).hooks[0]!);
    expect(cmd.type).toBe("command");
    expect(cmd.command).toBe('"/usr/bin/node" "/app/hooks/scripts/maestro-prompt.mjs" X_URL X_TOKEN');
    expect(cmd.timeout).toBe(TIMEOUT_DO_HOOK_S);
    expect(TIMEOUT_DO_HOOK_S).toBeLessThanOrEqual(1);
  });
  it("Electron como Node entra como prefixo de ambiente", () => {
    const f = fragmentoDeHooksDoMaestro({ ...opc, electronComoNode: true });
    expect(JSON.stringify(f)).toContain("ELECTRON_RUN_AS_NODE=1 ");
  });
  it("nome do produto nunca é literal no fragmento (sem marca embutida)", () => {
    expect(JSON.stringify(fragmentoDeHooksDoMaestro(opc))).not.toContain(PRODUTO.id);
  });
});

describe("soma de fragmentos (juntarHooksDoClaude)", () => {
  const rag = { UserPromptSubmit: [{ hooks: [{ type: "command", command: "rag-prompt", timeout: 5 }] }], SessionStart: [{ hooks: [] }] };
  it("o hook do Maestro SOMA ao do RAG e roda primeiro quando vem antes; não muta a entrada", () => {
    const m = fragmentoDeHooksDoMaestro(opc);
    const copia = JSON.stringify(rag);
    const j = juntarHooksDoClaude(m, rag, null, undefined);
    expect(j["UserPromptSubmit"]).toHaveLength(2);
    expect(JSON.stringify(j["UserPromptSubmit"]![0])).toContain("maestro-prompt.mjs");
    expect(JSON.stringify(j["UserPromptSubmit"]![1])).toContain("rag-prompt");
    expect(j["SessionStart"]).toHaveLength(1);
    expect(JSON.stringify(rag)).toBe(copia);
  });
});

describe("settings por Pane", () => {
  const base = { dirApp: "/app/dados", pane_id: "pane_l", nomeServidor: PRODUTO.id, executavelNode: "/usr/bin/node", script: "/app/gancho.mjs", variavelUrl: "X_URL", variavelToken: "X_TOKEN" };
  it("Pane livre sem Loja: settings só com o hook do Maestro, em arquivo POR Pane marcado como gerenciado", () => {
    const s = gerarSettingsSoMaestro({ ...base, maestroScript: opc.script });
    expect(s.caminho).toBe("/app/dados/panes/pane_l/claude-settings.json");
    const j = JSON.parse(s.conteudo) as Record<string, any>;
    expect(j[MARCADOR_GERENCIADO]).toBe(true);
    expect(Object.keys(j["hooks"])).toEqual(["UserPromptSubmit"]);
  });
  it("Pane livre COM Loja: o hook do Maestro SOMA ao gate da Loja (PreToolUse intacto)", () => {
    const j = JSON.parse(gerarSettingsSoGateLoja({ ...base, maestroScript: opc.script }).conteudo) as Record<string, any>;
    expect(Object.keys(j["hooks"]).sort()).toEqual(["PreToolUse", "UserPromptSubmit"]);
    expect(JSON.stringify(j["hooks"]["PreToolUse"])).toContain("pre-mcp");
    const sem = JSON.parse(gerarSettingsSoGateLoja(base).conteudo) as Record<string, any>;
    expect(Object.keys(sem["hooks"])).toEqual(["PreToolUse"]);
  });
  it("piloto e workers NUNCA recebem o hook do Maestro (settings da orquestração intacto)", () => {
    for (const papel of ["piloto", "executor", "explorador", "revisor"] as const) {
      const j = JSON.parse(gerarSettingsDoPane({ ...base, papel }).conteudo) as Record<string, any>;
      expect(JSON.stringify(j)).not.toContain("UserPromptSubmit");
      expect(JSON.stringify(j)).not.toContain("maestro-prompt");
    }
  });
});

describe("elegibilidade do Pane", () => {
  const ok = { cli: "claude", papel: "nenhum" as const, mission_modo: null, pane_do_maestro: false };
  it("só painel livre do Claude (sem Missão ou Missão livre) e não aberto pelo Maestro", () => {
    expect(painelElegivel(ok)).toBe(true);
    expect(painelElegivel({ ...ok, cli: "codex" })).toBe(false);
    expect(painelElegivel({ ...ok, cli: "opencode" })).toBe(false);
    expect(painelElegivel({ ...ok, papel: "piloto" })).toBe(false);
    expect(painelElegivel({ ...ok, papel: "executor", mission_modo: "livre" })).toBe(true); // Pane avulso de uma Missão livre
    for (const papel of ["piloto", "executor", "explorador", "revisor", "nenhum"] as const) for (const modo of ["squad", "agentico"] as const) expect(painelElegivel({ ...ok, papel, mission_modo: modo })).toBe(false);
    expect(painelElegivel({ ...ok, mission_modo: "livre" })).toBe(true); // painel livre numa Missão de modo livre
    for (const modo of ["squad", "agentico"] as const) expect(painelElegivel({ ...ok, mission_modo: modo })).toBe(false);
    expect(painelElegivel({ ...ok, pane_do_maestro: true })).toBe(false);
  });
});

describe("gancho `maestro-prompt` na orquestração", () => {
  const deps = (extra: Record<string, unknown>) =>
    criarGanchosClaude({ handoff: {} as never, fila: {} as never, contexto: async () => null, raiz: async () => "/r", ...extra } as never);
  const c = { workspace_id: "ws", mission_id: null, pane_id: "p" };
  it("delega ao decisor do Maestro e devolve o bloqueio", async () => {
    const g = deps({ maestroPrompt: async () => ({ saida: { decision: "block", reason: "r" } }) });
    expect(await g.tratar("maestro-prompt", c, {})).toEqual({ saida: { decision: "block", reason: "r" } });
  });
  it("sem Maestro (ou erro) o prompt segue: saída vazia", async () => {
    expect(await deps({}).tratar("maestro-prompt", c, {})).toEqual({ saida: null });
    expect(await deps({ maestroPrompt: async () => { throw new Error("x"); } }).tratar("maestro-prompt", c, {})).toEqual({ saida: null });
  });
});
