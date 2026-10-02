// Settings do painel livre que orquestra (D-425): allow só das tools de ABRIR/LER do próprio MCP do app; sem hooks de worker/piloto; gate da Loja só quando há Loja.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUTO } from "../../produto";
import { TOOLS_AVULSO } from "../../mcp/catalogo";
import { MATCHER_MCP_LOJA, TOOLS_AVULSO_SEM_APROVACAO, gerarSettingsDoPaneAvulso } from "./claude";

const base = { dirApp: "/app/dados", pane_id: "pane_a1", nomeServidor: PRODUTO.id, executavelNode: "/usr/bin/node", script: "/app/gancho.mjs", variavelUrl: "X_URL", variavelToken: "X_TOKEN" };

describe("settings do painel avulso", () => {
  it("allow SÓ nas tools de abrir e ler do app; escrita em outro painel e fechamento continuam pedindo aprovação", () => {
    const s = gerarSettingsDoPaneAvulso(base);
    expect(s.caminho).toBe(join("/app/dados", "panes", "pane_a1", "claude-settings.json"));
    const j = JSON.parse(s.conteudo);
    expect(j[`managed_by_${PRODUTO.id}`]).toBe(true);
    expect(j.permissions.allow).toEqual(TOOLS_AVULSO_SEM_APROVACAO.map((t) => `mcp__${PRODUTO.id}__${t}`));
    expect(TOOLS_AVULSO_SEM_APROVACAO).toContain("pane_spawn");
    expect(TOOLS_AVULSO_SEM_APROVACAO).not.toContain("pane_send");
    expect(TOOLS_AVULSO_SEM_APROVACAO).not.toContain("pane_close");
    for (const t of TOOLS_AVULSO_SEM_APROVACAO) expect(TOOLS_AVULSO).toContain(t);
    expect(j.hooks).toBeUndefined();
  });

  it("nenhum hook de piloto/worker (sem guarda de escrita, sem Stop de handoff)", () => {
    const j = JSON.parse(gerarSettingsDoPaneAvulso({ ...base, gateMcpLoja: true }).conteudo);
    expect(Object.keys(j.hooks)).toEqual(["PreToolUse"]);
    expect(j.hooks.PreToolUse).toHaveLength(1);
    expect(j.hooks.PreToolUse[0].matcher).toBe(MATCHER_MCP_LOJA);
    expect(j.hooks.Stop).toBeUndefined();
  });

  it("deny opcional entra e pane_id com traversal é recusado", () => {
    expect(JSON.parse(gerarSettingsDoPaneAvulso({ ...base, deny: ["Bash(git push:*)"] }).conteudo).permissions.deny).toEqual(["Bash(git push:*)"]);
    expect(() => gerarSettingsDoPaneAvulso({ ...base, pane_id: "../x" })).toThrow();
  });
});
