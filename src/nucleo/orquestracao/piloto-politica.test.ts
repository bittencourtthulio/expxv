// Política de skills/MCP no comando do piloto/worker (Fase 7, T-07.19/21/23): isolamento duro (Claude) e parcial (Codex/OpenCode).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PoliticaResolvida } from "../../compartilhado/catalogo";
import { NIVEL_POR_CLI } from "../catalogo/politica";
import { criarEmissorDeTokens } from "../mcp/tokens";
import { montarComandoWorker, type EntradaComando, type EntradaWorker, type PoliticaNoComando } from "./piloto";

const resolvida = (extra: Partial<PoliticaResolvida> = {}): PoliticaResolvida => ({ skills: ["evbuilder", "pdf"], faltando: [], mcp_do_usuario: "nenhum", servidores_mcp: [], isolamento: { ...NIVEL_POR_CLI }, ...extra });
const politica = (extra: Partial<PoliticaNoComando> = {}): PoliticaNoComando => ({ resolvida: resolvida(), skillsConhecidas: ["pdf", "docx", "evbuilder"], servidoresUsuario: ["github"], temPluginEfemero: true, ...extra });

function worker(ferramenta: string, extra: Partial<EntradaComando> = {}): EntradaWorker {
  const emissor = criarEmissorDeTokens();
  const dirApp = mkdtempSync(join(tmpdir(), "piloto-pol-"));
  return {
    ferramenta, executavel: `/bin/${ferramenta}`, permissao: "seguro",
    servidor: { url: "http://127.0.0.1:4567/mcp", urlGanchos: "http://127.0.0.1:4567/hooks", emitirToken: (x) => emissor.emitir(x), revogar: (id) => emissor.revogar(id) },
    dirApp, pane_id: "pane_w", workspace_id: "ws_1", mission_id: "mis_1", modo: "squad",
    ganchos: { executavelNode: "/usr/bin/node", script: "/app/gancho.mjs" },
    papel: "executor", task_id: "t1", task_ref: "T-01.01", briefing_path: null, ...extra,
  };
}
const arq = (c: { arquivos: Array<{ caminho: string; conteudo: string }> }, fim: string): string => c.arquivos.find((a) => a.caminho.endsWith(fim))?.conteudo ?? "";

describe("política no comando", () => {
  it("sem política (ou livre) o comando é idêntico ao anterior", async () => {
    const dirApp = mkdtempSync(join(tmpdir(), "piloto-pol-igual-"));
    const a = await montarComandoWorker(worker("claude", { dirApp }));
    const b = await montarComandoWorker(worker("claude", { dirApp, politica: politica({ resolvida: resolvida({ skills: null }), temPluginEfemero: false }) }));
    expect(b.argumentos).toEqual(a.argumentos);
    expect(arq(b, "claude-settings.json")).toBe(arq(a, "claude-settings.json"));
  });
  it("Claude: strict-mcp, plugin-dir, gates e deny entram; nada fora de <dirApp>/panes/<pane>", async () => {
    const e = worker("claude", { politica: politica() });
    const c = await montarComandoWorker(e);
    expect(c.argumentos).toContain("--strict-mcp-config");
    const i = c.argumentos.indexOf("--plugin-dir");
    expect(c.argumentos[i + 1]).toBe(join(e.dirApp, "panes", "pane_w", "plugin"));
    const s = JSON.parse(arq(c, "claude-settings.json")) as { permissions: { deny: string[] }; hooks: { PreToolUse: Array<{ matcher: string }> } };
    expect(s.permissions.deny).toEqual(["Skill(docx)"]);
    expect(s.hooks.PreToolUse.map((x) => x.matcher)).toEqual(["Skill", "mcp__.*"]);
    for (const a of c.arquivos) expect(a.caminho.startsWith(join(e.dirApp, "panes", "pane_w"))).toBe(true);
  });
  it("Claude com lista de MCP: sem strict-mcp, deny nos servidores de fora", async () => {
    const c = await montarComandoWorker(worker("claude", { politica: politica({ resolvida: resolvida({ mcp_do_usuario: "lista", servidores_mcp: ["slack"] }) }) }));
    expect(c.argumentos).not.toContain("--strict-mcp-config");
    expect((JSON.parse(arq(c, "claude-settings.json")) as { permissions: { deny: string[] } }).permissions.deny).toContain("mcp__github");
  });
  it("Codex: skills permitidas como TEXTO nas instruções; nenhum arquivo de config da CLI tocado (CODEX_HOME intacto)", async () => {
    const c = await montarComandoWorker(worker("codex", { politica: politica() }));
    expect(arq(c, "instrucoes.md")).toContain("Use SOMENTE estas skills: evbuilder, pdf.");
    expect(Object.keys(c.ambiente)).not.toContain("CODEX_HOME");
    expect(c.argumentos.join(" ")).not.toContain("auth.json");
  });
  it("OpenCode: texto sempre; permission.skill só com suporte confirmado pelo contrato", async () => {
    const sem = await montarComandoWorker(worker("opencode", { politica: politica() }));
    expect(arq(sem, "instrucoes.md")).toContain("Use SOMENTE estas skills");
    expect(JSON.parse(sem.ambiente["OPENCODE_CONFIG_CONTENT"] as string)).not.toHaveProperty("permission");
    const com = await montarComandoWorker(worker("opencode", { politica: politica({ opencodeSuportaPermissaoSkill: true }) }));
    expect(JSON.parse(com.ambiente["OPENCODE_CONFIG_CONTENT"] as string).permission).toEqual({ skill: { "*": "deny", evbuilder: "allow", pdf: "allow" } });
  });
});
