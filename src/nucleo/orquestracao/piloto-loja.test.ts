// Servidores da Loja no comando do piloto/worker (Fase 7B, T-07B.20): fusão com o MCP do app por CLI, ambiente de loopback e settings.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configuracaoDeMcpLoja } from "../loja-mcp/injecao";
import type { EntradaMcp } from "../loja-mcp/esquema";
import { criarEmissorDeTokens } from "../mcp/tokens";
import { PRODUTO } from "../produto";
import { VARIAVEL_LOJA_TOKEN, VARIAVEL_LOJA_URL, montarComandoPiloto, montarComandoWorker, type EntradaComando, type EntradaPiloto, type EntradaWorker, type LojaNoComando } from "./piloto";
import { catalogoFalso } from "../../../tests/fixtures/mcp-loja/apoio-ciclo";

const cat = catalogoFalso();
const servidor = (id: string, definidas: string[] = []) => ({ entrada: cat.porId.get(id)!.entrada as EntradaMcp, definidas: new Set(definidas) });
const lojaCom = (...ss: ReturnType<typeof servidor>[]): LojaNoComando => ({
  url: "http://127.0.0.1:4567/loja/segredos",
  configurar: (cli, arquivo) => configuracaoDeMcpLoja(cli, ss, { userData: "/u", node: "/usr/bin/node", nodeEhElectron: false, lancador: { script: "/r/mcp-run.mjs", variavelUrl: VARIAVEL_LOJA_URL, variavelToken: VARIAVEL_LOJA_TOKEN } }, arquivo),
});

function entrada(ferramenta: string, extra: Partial<EntradaComando> = {}) {
  const emissor = criarEmissorDeTokens();
  const dirApp = mkdtempSync(join(tmpdir(), "piloto-loja-"));
  const e: EntradaComando = {
    ferramenta, executavel: `/bin/${ferramenta}`, permissao: "seguro",
    servidor: { url: "http://127.0.0.1:4567/mcp", urlGanchos: "http://127.0.0.1:4567/hooks", emitirToken: (x) => emissor.emitir(x), revogar: (id) => emissor.revogar(id) },
    dirApp, pane_id: "pane_p", workspace_id: "ws_1", mission_id: "mis_1", modo: "agentico",
    ganchos: { executavelNode: "/usr/bin/node", script: "/app/gancho.mjs" }, ...extra,
  };
  return e;
}
const piloto = (e: EntradaComando): EntradaPiloto => ({ ...e, objetivo: "faça" });

describe("Loja no comando", () => {
  it("sem `loja` (ou sem servidores) o comando é idêntico ao MVP", async () => {
    const dirApp = mkdtempSync(join(tmpdir(), "piloto-loja-igual-"));
    const sem = await montarComandoPiloto(piloto(entrada("claude", { dirApp })));
    const vazia = await montarComandoPiloto(piloto(entrada("claude", { dirApp, loja: lojaCom() })));
    expect(vazia.argumentos).toEqual(sem.argumentos);
    expect(Object.keys(vazia.ambiente).sort()).toEqual(Object.keys(sem.ambiente).sort());
    expect(vazia.arquivos.map((a) => a.caminho)).toEqual(sem.arquivos.map((a) => a.caminho));
    expect(Object.keys(vazia.ambiente)).not.toContain(VARIAVEL_LOJA_URL);
  });

  it("Claude: um só --mcp-config com os dois servidores; gate no settings; token de loopback no ambiente; segredo nunca no argv", async () => {
    const c = await montarComandoPiloto(piloto(entrada("claude", { loja: lojaCom(servidor("falso-ok"), servidor("falso-chave", ["FALSO_API_KEY"])) })));
    expect(c.argumentos.filter((a) => a === "--mcp-config")).toHaveLength(1);
    const mcp = JSON.parse(c.arquivos.find((f) => f.caminho.endsWith("mcp.json"))!.conteudo) as { mcpServers: Record<string, { args?: string[] }> };
    expect(Object.keys(mcp.mcpServers).sort()).toEqual([PRODUTO.id, "ev_falso_chave", "ev_falso_ok"].sort());
    expect(mcp.mcpServers["ev_falso_chave"]!.args).toEqual(["/r/mcp-run.mjs", "--servidor", "falso-chave"]);
    const settings = JSON.parse(c.arquivos.find((f) => f.caminho.endsWith("claude-settings.json"))!.conteudo) as { hooks: { PreToolUse: Array<{ matcher: string }> } };
    expect(settings.hooks.PreToolUse.map((h) => h.matcher)).toContain("mcp__ev_.*");
    expect(c.ambiente[VARIAVEL_LOJA_URL]).toBe("http://127.0.0.1:4567/loja/segredos");
    expect(c.ambiente[VARIAVEL_LOJA_TOKEN]).toBe(c.ambiente[`${PRODUTO.prefixoEnv}MCP_TOKEN`]);
    expect(JSON.stringify(c.argumentos)).not.toMatch(/FALSO_API_KEY=|chave-valida/);
  });

  it("Codex: -c do app + -c da Loja no mesmo argv; env_vars só com NOMES; worker também recebe", async () => {
    const c = await montarComandoPiloto(piloto(entrada("codex", { loja: lojaCom(servidor("falso-chave", ["FALSO_API_KEY"])) })));
    const junto = c.argumentos.join("\n");
    expect(junto).toContain(`mcp_servers.${PRODUTO.id}.url=`);
    expect(junto).toContain("mcp_servers.ev_falso_chave.command=");
    expect(junto).toContain(`mcp_servers.ev_falso_chave.env_vars=["${VARIAVEL_LOJA_URL}","${VARIAVEL_LOJA_TOKEN}"]`);
    expect(c.ambiente[VARIAVEL_LOJA_TOKEN]).toMatch(/\S+/);
    const w = await montarComandoWorker({ ...entrada("codex", { loja: lojaCom(servidor("falso-ok")) }), papel: "executor", task_id: "t1", task_ref: "T-1", briefing_path: null } as EntradaWorker);
    expect(w.argumentos.join("\n")).toContain("mcp_servers.ev_falso_ok.command=");
  });

  it("OpenCode: OPENCODE_CONFIG_CONTENT funde instructions + mcp do app + mcp da Loja (uma variável só)", async () => {
    const c = await montarComandoPiloto(piloto(entrada("opencode", { loja: lojaCom(servidor("falso-ok")) })));
    const cfg = JSON.parse(c.ambiente["OPENCODE_CONFIG_CONTENT"]!) as { instructions: string[]; mcp: Record<string, unknown> };
    expect(cfg.instructions).toHaveLength(1);
    expect(Object.keys(cfg.mcp).sort()).toEqual([PRODUTO.id, "ev_falso_ok"].sort());
    expect(c.ambiente[VARIAVEL_LOJA_URL]).toBe("http://127.0.0.1:4567/loja/segredos");
  });

  it("CLI sem injeção (configurar devolve null): nada da Loja entra", async () => {
    const c = await montarComandoPiloto(piloto(entrada("claude", { loja: { url: "http://127.0.0.1:1/loja/segredos", configurar: () => null } })));
    expect(Object.keys(c.ambiente)).not.toContain(VARIAVEL_LOJA_URL);
    expect(c.argumentos.filter((a) => a === "--mcp-config")).toHaveLength(1);
  });
});
