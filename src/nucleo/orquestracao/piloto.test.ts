import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { criarEmissorDeTokens } from "../mcp/tokens";
import { matrizPorModo } from "../mcp/catalogo";
import { PRODUTO } from "../produto";
import { MARCADOR_GERENCIADO } from "./hooks/claude";
import {
  VARIAVEL_TOKEN,
  gravarArquivosDoComando,
  montarComandoPiloto,
  montarComandoWorker,
  prepararRespawnPiloto,
  type EntradaComando,
  type EntradaPiloto,
  type EntradaWorker,
} from "./piloto";

function base(p: Partial<EntradaComando> = {}) {
  const emissor = criarEmissorDeTokens();
  const dirApp = mkdtempSync(join(tmpdir(), "piloto-"));
  const e: EntradaComando = {
    ferramenta: "claude", executavel: "/usr/local/bin/claude", permissao: "seguro",
    servidor: { url: "http://127.0.0.1:4567/mcp", urlGanchos: "http://127.0.0.1:4567/hooks", emitirToken: (x) => emissor.emitir(x), revogar: (id) => emissor.revogar(id) },
    dirApp, pane_id: "pane_p", workspace_id: "ws_1", mission_id: "mis_1", modo: "agentico",
    ganchos: { executavelNode: "/usr/bin/node", script: "/app/gancho.mjs" }, ...p,
  };
  return { e, emissor, dirApp };
}
const piloto = (p: Partial<EntradaPiloto> = {}, b = base()) => ({ ...b, entrada: { ...b.e, objetivo: "Crie o login", ...p } as EntradaPiloto });
const worker = (p: Partial<EntradaWorker> = {}, b = base({ pane_id: "pane_w1" })) => ({ ...b, entrada: { ...b.e, papel: "executor", task_id: "tsk_1", task_ref: "T-01.01", briefing_path: `${PRODUTO.pastaNoProjeto}/missoes/mis_1/briefing-T-01.01.md`, ...p } as EntradaWorker });

describe("comando do piloto", () => {
  it("Claude: argv sem shell, config MCP com token, settings do Pane, instruções por --append-system-prompt, prompt inicial por último", async () => {
    const { entrada, emissor, dirApp } = piloto();
    const c = await montarComandoPiloto(entrada);
    expect(c.executavel).toBe("/usr/local/bin/claude");
    expect(Array.isArray(c.argumentos)).toBe(true);
    const a = c.argumentos;
    expect(a[a.indexOf("--mcp-config") + 1]).toBe(join(dirApp, "panes", "pane_p", "mcp.json"));
    expect(a[a.indexOf("--settings") + 1]).toBe(join(dirApp, "panes", "pane_p", "claude-settings.json"));
    expect(a[a.indexOf("--append-system-prompt") + 1]).toContain("Você é o piloto");
    expect(a[a.length - 1]).toBe("Crie o login");
    expect(a).not.toContain("--dangerously-skip-permissions");
    // o arquivo do MCP leva o Bearer; o token é de piloto e só dá as tools do modo agêntico
    const mcp = JSON.parse(c.arquivos.find((f) => f.caminho.endsWith("mcp.json"))?.conteudo ?? "{}");
    const token = String(mcp.mcpServers[PRODUTO.id].headers.Authorization).replace("Bearer ", "");
    const claims = emissor.verificar(token);
    expect(claims).toMatchObject({ role: "piloto", mode: "agentico", pane_id: "pane_p", mission_id: "mis_1" });
    expect([...(claims?.tools_allow ?? [])].sort()).toEqual([...matrizPorModo("agentico")].sort());
    expect(c.ambiente[VARIAVEL_TOKEN]).toBe(token);
    expect(c.estrategia_handoff).toBe("nenhuma");
    const settings = JSON.parse(c.arquivos.find((f) => f.caminho.endsWith("claude-settings.json"))?.conteudo ?? "{}");
    expect(settings[MARCADOR_GERENCIADO]).toBe(true);
    expect(settings.hooks.PreToolUse).toBeDefined();
  });

  it("todos os arquivos ficam no diretório do app; nenhum no home/projeto do usuário", async () => {
    const { entrada, dirApp } = piloto();
    const c = await montarComandoPiloto(entrada);
    for (const f of c.arquivos) expect(f.caminho.startsWith(join(dirApp, "panes"))).toBe(true);
    await gravarArquivosDoComando(dirApp, c.arquivos);
    for (const f of c.arquivos) expect(statSync(f.caminho).mode & 0o777).toBe(0o600);
    await expect(gravarArquivosDoComando(dirApp, [{ caminho: join(dirApp, "..", "fora.txt"), conteudo: "x" }])).rejects.toThrow();
  });

  it("permissão automática só sai quando o workspace habilitou (D-14)", async () => {
    const seguro = await montarComandoPiloto(piloto({ permissao: "seguro" }).entrada);
    const auto = await montarComandoPiloto(piloto({ permissao: "automatico" }).entrada);
    expect(seguro.argumentos).not.toContain("--dangerously-skip-permissions");
    expect(auto.argumentos).toContain("--dangerously-skip-permissions");
  });

  it("Codex: -c do MCP, arquivo de instruções por flag, token só no ambiente", async () => {
    const { entrada, dirApp } = piloto({ ferramenta: "codex", executavel: "/bin/codex" });
    const c = await montarComandoPiloto(entrada);
    const instrucoes = join(dirApp, "panes", "pane_p", "instrucoes.md");
    expect(c.argumentos).toContain(`model_instructions_file=${JSON.stringify(instrucoes)}`);
    expect(c.argumentos.some((x) => x.startsWith(`mcp_servers.${PRODUTO.id}.url=`))).toBe(true);
    expect(c.argumentos.join(" ")).not.toContain(c.ambiente[VARIAVEL_TOKEN] as string);
    expect(c.argumentos.at(-1)).toBe("Crie o login");
    expect(c.arquivos.find((f) => f.caminho === instrucoes)?.conteudo).toContain("Você é o piloto");
  });

  it("OpenCode: instruções e MCP fundidos em OPENCODE_CONFIG_CONTENT; prompt por --prompt", async () => {
    const { entrada, dirApp } = piloto({ ferramenta: "opencode", executavel: "/bin/opencode" });
    const c = await montarComandoPiloto(entrada);
    const cfg = JSON.parse(c.ambiente["OPENCODE_CONFIG_CONTENT"] ?? "{}");
    expect(cfg.instructions).toEqual([join(dirApp, "panes", "pane_p", "instrucoes.md")]);
    expect(cfg.mcp[PRODUTO.id].type).toBe("remote");
    expect(c.argumentos.slice(-2)).toEqual(["--prompt", "Crie o login"]);
  });

  it.each(["gemini", "aider", "qwen", "kilo", "terminal"])("CLI sem contrato de intake (%s) → pilot_cli_unsupported_intake", async (ferramenta) => {
    await expect(montarComandoPiloto(piloto({ ferramenta }).entrada)).rejects.toMatchObject({ code: "rule_violation", subcode: "pilot_cli_unsupported_intake" });
  });

  it("sem objetivo usa um prompt inicial padrão de intake", async () => {
    const c = await montarComandoPiloto(piloto({ objetivo: null }).entrada);
    expect(c.prompt_inicial).toContain("intake");
  });
});

describe("comando do worker", () => {
  it("contexto limpo e prompt mínimo 'execute o card X e entregue pelo handoff'; token só com handoff_submit", async () => {
    const { entrada, emissor } = worker();
    const c = await montarComandoWorker(entrada);
    expect(c.argumentos).not.toContain("--resume");
    expect(c.argumentos).not.toContain("--append-system-prompt");
    const prompt = c.argumentos.at(-1) ?? "";
    expect(prompt).toContain("Execute o card T-01.01");
    expect(prompt).toContain("handoff_submit");
    expect(prompt).toContain("tsk_1");
    expect(prompt.length).toBeLessThan(300);
    const claims = emissor.verificar(String(c.ambiente[VARIAVEL_TOKEN]));
    expect(claims).toMatchObject({ role: "executor", pane_id: "pane_w1", mission_id: "mis_1" });
    expect(claims?.tools_allow).toEqual(["handoff_submit"]);
    expect(c.estrategia_handoff).toBe("hooks");
    const settings = JSON.parse(c.arquivos.find((f) => f.caminho.endsWith("claude-settings.json"))?.conteudo ?? "{}");
    expect(settings.hooks.Stop[0].hooks).toHaveLength(2);
  });

  it("revisor recebe as instruções do revisor; Codex worker usa fallback de ociosidade", async () => {
    const c = await montarComandoWorker(worker({ papel: "revisor", ferramenta: "codex", executavel: "/bin/codex" }).entrada);
    expect(c.estrategia_handoff).toBe("fallback");
    expect(c.arquivos.find((f) => f.caminho.endsWith("instrucoes.md"))?.conteudo).toContain("revisor");
  });

  it("CLI sem MCP/argv não serve de worker → unavailable", async () => {
    await expect(montarComandoWorker(worker({ ferramenta: "gemini" }).entrada)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("pane_id com traversal é recusado", async () => {
    await expect(montarComandoWorker(worker({ pane_id: "../x" }).entrada)).rejects.toThrow();
  });
});

describe("respawn do piloto (troca de conta)", () => {
  it("mantém o MESMO pane_id, revoga o token antigo e emite um novo", async () => {
    const b = base();
    const primeiro = await montarComandoPiloto({ ...b.e, objetivo: "x" });
    const tokenAntigo = String(primeiro.ambiente[VARIAVEL_TOKEN]);
    expect(b.emissor.verificar(tokenAntigo)).not.toBeNull();
    const r = await prepararRespawnPiloto({ ...b.e, objetivo: null, conta_id: "conta_b", handoff_da_missao: "Planejamos 3 cards; 1 entregue.", conteudo_persistido: true });
    expect(r.pane_id).toBe("pane_p");
    expect(r.conta_id).toBe("conta_b");
    expect(r.aviso_sem_conteudo).toBe(false);
    expect(b.emissor.verificar(tokenAntigo)).toBeNull();
    const novo = String(r.comando.ambiente[VARIAVEL_TOKEN]);
    expect(b.emissor.verificar(novo)).toMatchObject({ pane_id: "pane_p", role: "piloto" });
    expect(r.comando.argumentos.at(-1)).toContain("Planejamos 3 cards");
  });

  it("sem conteúdo persistido: aviso amarelo e prompt sem inventar contexto", async () => {
    const b = base();
    const r = await prepararRespawnPiloto({ ...b.e, objetivo: null, conta_id: null, handoff_da_missao: null, conteudo_persistido: false });
    expect(r.pane_id).toBe("pane_p");
    expect(r.aviso_sem_conteudo).toBe(true);
    expect(r.comando.argumentos.at(-1)).toContain("não foi preservado");
  });
});
