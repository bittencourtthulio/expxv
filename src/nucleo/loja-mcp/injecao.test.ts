import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { combinarAmbientes, configuracaoDeMcp } from "../terminais/catalogo";
import { combinarConfiguracoesMcp, configuracaoDeMcpLoja, nomeNaCli, padraoToolDoServidor, type ContextoInjecao, type ServidorLojaPane } from "./injecao";
import { carregarCatalogo } from "./catalogo";
import { catalogoFalso, limparPastas, novaPasta, SEED } from "../../../tests/fixtures/mcp-loja/apoio-ciclo";
import { PRODUTO, variavelDeAmbiente } from "../produto";

afterEach(limparPastas);
const cat = catalogoFalso();
const real = carregarCatalogo(SEED);
const SEGREDO = "SENTINELA-injecao-5d2a-nunca-no-argv";
const ctx: ContextoInjecao = {
  userData: "/dados/app", workspace: undefined, plataforma: "darwin", node: "/usr/bin/node", nodeEhElectron: false,
  lancador: { script: "/app/resources/mcp/mcp-run.mjs", variavelUrl: variavelDeAmbiente("LOJA_URL"), variavelToken: variavelDeAmbiente("LOJA_TOKEN") },
};
const srv = (id: string, definidas: string[] = [], publicos: Record<string, string> = {}, c = cat): ServidorLojaPane => ({ entrada: c.porId.get(id)!.entrada, definidas: new Set(definidas), publicos });
const ARQ = "/dados/app/panes/p1/mcp.json";

describe("nome na CLI", () => {
  it("ev_<id com _>, ≤ 40, e o padrão de tool do gate", () => {
    expect(nomeNaCli("sequential-thinking")).toBe("ev_sequential_thinking");
    expect(nomeNaCli("a".repeat(48)).length).toBe(40);
    expect(padraoToolDoServidor("context7")).toBe("mcp__ev_context7__*");
    expect(() => nomeNaCli("../x")).toThrow();
    expect(() => nomeNaCli("Maiuscula")).toThrow();
  });
});

describe("configuracaoDeMcpLoja", () => {
  it("CLI sem injeção por Pane (Gemini e desconhecidas): null", () => {
    expect(configuracaoDeMcpLoja("gemini", [srv("falso-ok")], ctx, ARQ)).toBeNull();
    expect(configuracaoDeMcpLoja("aider", [srv("falso-ok")], ctx, ARQ)).toBeNull();
  });

  it("lista vazia: configuração vazia (nada a injetar)", () => {
    for (const cli of ["claude", "codex", "opencode"]) expect(configuracaoDeMcpLoja(cli, [], ctx, ARQ)).toMatchObject({ argumentos: [], ambiente: {}, arquivo: null, servidores: [] });
  });

  it("Claude: arquivo único com mcpServers (stdio direto e remoto), flag --mcp-config e strict em Missão restrita", () => {
    const c = configuracaoDeMcpLoja("claude", [srv("falso-ok"), srv("falso-remoto")], ctx, ARQ)!;
    expect(c.argumentos).toEqual(["--mcp-config", ARQ]);
    const j = JSON.parse(c.arquivo!) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(Object.keys(j.mcpServers)).toEqual(["ev_falso_ok", "ev_falso_remoto"]);
    expect(j.mcpServers["ev_falso_ok"]).toMatchObject({ type: "stdio", command: "/usr/bin/node", args: ["/dados/app/mcp/falso-ok/node_modules/.bin/servidor.mjs"] });
    expect(j.mcpServers["ev_falso_remoto"]).toMatchObject({ type: "http", url: expect.stringMatching(/^https:\/\//) });
    expect(c.nomes).toEqual({ "falso-ok": "ev_falso_ok", "falso-remoto": "ev_falso_remoto" });
    expect(configuracaoDeMcpLoja("claude", [srv("falso-ok")], { ...ctx, estrito: true }, ARQ)!.argumentos).toEqual(["--mcp-config", ARQ, "--strict-mcp-config"]);
  });

  it("servidor com segredo definido usa o LANÇADOR: nada do segredo em argv/arquivo/ambiente, só nomes de variável de loopback", () => {
    const s = srv("falso-chave", ["FALSO_API_KEY"]);
    for (const cli of ["claude", "codex", "opencode"]) {
      const c = configuracaoDeMcpLoja(cli, [s], ctx, ARQ)!;
      const tudo = JSON.stringify(c);
      expect(tudo).not.toContain(SEGREDO);
      expect(tudo).toContain("mcp-run.mjs");
      expect(tudo).toContain("--servidor");
      expect(tudo).not.toContain("servidor.mjs"); // o executável real só é conhecido pelo lançador
      expect(c.ambiente_requerido).toEqual([ctx.lancador.variavelUrl, ctx.lancador.variavelToken]);
    }
    const claude = JSON.parse(configuracaoDeMcpLoja("claude", [s], ctx, ARQ)!.arquivo!) as { mcpServers: Record<string, { env: Record<string, string>; args: string[] }> };
    expect(claude.mcpServers["ev_falso_chave"]!.args).toEqual(["/app/resources/mcp/mcp-run.mjs", "--servidor", "falso-chave"]);
    expect(claude.mcpServers["ev_falso_chave"]!.env[ctx.lancador.variavelToken]).toBe("${" + ctx.lancador.variavelToken + "}");
  });

  it("Electron como Node: ELECTRON_RUN_AS_NODE só no ambiente do servidor", () => {
    const c = configuracaoDeMcpLoja("claude", [srv("falso-chave", ["FALSO_API_KEY"])], { ...ctx, nodeEhElectron: true, node: "/Apps/E.app/E" }, ARQ)!;
    const j = JSON.parse(c.arquivo!) as { mcpServers: Record<string, { command: string; env: Record<string, string> }> };
    expect(j.mcpServers["ev_falso_chave"]!.command).toBe("/Apps/E.app/E");
    expect(j.mcpServers["ev_falso_chave"]!.env["ELECTRON_RUN_AS_NODE"]).toBe("1");
    expect(c.ambiente).toEqual({});
  });

  it("segredo opcional NÃO definido: roda direto, sem lançador e sem processo extra", () => {
    const c = configuracaoDeMcpLoja("claude", [srv("context7")], ctx, ARQ)!;
    expect(c.ambiente_requerido).toEqual([]);
    expect(c.arquivo).not.toContain("mcp-run");
    const definido = configuracaoDeMcpLoja("claude", [srv("context7", ["CONTEXT7_API_KEY"])], ctx, ARQ)!;
    expect(definido.arquivo).toContain("mcp-run");
  });

  it("segredo citado em args ({{SEGREDO}}) SEMPRE usa o lançador (o valor jamais é resolvido aqui)", () => {
    const c = configuracaoDeMcpLoja("codex", [srv("stripe-npm", ["STRIPE_SECRET_KEY"], {}, real)], ctx, ARQ)!;
    expect(c.argumentos.join(" ")).toContain("mcp-run.mjs");
    expect(c.argumentos.join(" ")).not.toMatch(/--api-key|STRIPE_SECRET_KEY=/);
  });

  it("variável pública entra no ambiente do servidor direto", () => {
    const c = configuracaoDeMcpLoja("claude", [srv("falso-publica", [], { FALSO_PROJETO: "proj-9" })], ctx, ARQ)!;
    const j = JSON.parse(c.arquivo!) as { mcpServers: Record<string, { env?: Record<string, string> }> };
    expect(j.mcpServers["ev_falso_publica"]!.env).toEqual({ FALSO_PROJETO: "proj-9" });
  });

  it("Codex: -c por chave (command, args, env, env_vars), nomes [a-z0-9_], remoto por url", () => {
    const c = configuracaoDeMcpLoja("codex", [srv("falso-publica", [], { FALSO_PROJETO: "p" }), srv("falso-chave", ["FALSO_API_KEY"]), srv("falso-remoto")], ctx, ARQ)!;
    expect(c.arquivo).toBeNull();
    expect(c.ambiente).toEqual({});
    const a = c.argumentos;
    expect(a.filter((x) => x === "-c")).toHaveLength(a.length / 2);
    expect(a).toContain('mcp_servers.ev_falso_publica.command="/usr/bin/node"');
    expect(a).toContain('mcp_servers.ev_falso_publica.env={FALSO_PROJETO="p"}');
    expect(a).toContain('mcp_servers.ev_falso_chave.args=["/app/resources/mcp/mcp-run.mjs","--servidor","falso-chave"]');
    expect(a).toContain(`mcp_servers.ev_falso_chave.env_vars=["${ctx.lancador.variavelUrl}","${ctx.lancador.variavelToken}"]`);
    expect(a.some((x) => /^mcp_servers\.ev_falso_remoto\.url="https:\/\//.test(x))).toBe(true);
  });

  it("OpenCode: OPENCODE_CONFIG_CONTENT com mcp local/remote e referências {env:VAR}", () => {
    const c = configuracaoDeMcpLoja("opencode", [srv("falso-ok"), srv("falso-chave", ["FALSO_API_KEY"]), srv("falso-remoto")], ctx, ARQ)!;
    expect(c.argumentos).toEqual([]);
    const j = JSON.parse(c.ambiente["OPENCODE_CONFIG_CONTENT"]!) as { mcp: Record<string, Record<string, unknown>> };
    expect(j.mcp["ev_falso_ok"]).toMatchObject({ type: "local", enabled: true, command: ["/usr/bin/node", "/dados/app/mcp/falso-ok/node_modules/.bin/servidor.mjs"] });
    expect(j.mcp["ev_falso_chave"]).toMatchObject({ environment: { [ctx.lancador.variavelToken]: `{env:${ctx.lancador.variavelToken}}` } });
    expect(j.mcp["ev_falso_remoto"]).toMatchObject({ type: "remote", enabled: true });
  });

  it("chave de servidor REMOTO não é injetada (aviso honesto) e jamais aparece na configuração", () => {
    const c = configuracaoDeMcpLoja("claude", [srv("github-remoto", ["GITHUB_PERSONAL_ACCESS_TOKEN"], {}, real)], ctx, ARQ)!;
    expect(c.avisos.join(" ")).toMatch(/chave remota não é injetada/);
    expect(c.arquivo).not.toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
  });

  it("servidor docker sem workspace válido propaga erro nominal (nunca monta a casa)", () => {
    // a entrada do seed que usa {{WORKSPACE}} sem workspace informado não produz configuração silenciosa
    expect(() => configuracaoDeMcpLoja("claude", [srv("filesystem", [], {}, real)], { ...ctx, workspace: "/nao/existe/mesmo" }, ARQ)).toThrow();
  });

  it("desempenho: 10 servidores × 3 CLIs em ≤ 5 ms por CLI; arquivo ≤ 16 KB (P-97)", () => {
    const ids = ["falso-ok", "falso-publica", "falso-chave", "falso-lento", "falso-vazio", "falso-crash", "falso-eco", "falso-remoto", "context7", "deepwiki"];
    const lista = ids.map((i) => srv(i, i === "falso-chave" ? ["FALSO_API_KEY"] : []));
    for (const cli of ["claude", "codex", "opencode"]) {
      configuracaoDeMcpLoja(cli, lista, ctx, ARQ);
      const t0 = performance.now();
      const c = configuracaoDeMcpLoja(cli, lista, ctx, ARQ)!;
      expect(performance.now() - t0).toBeLessThan(5);
      expect((c.arquivo ?? "").length + JSON.stringify(c.ambiente).length).toBeLessThan(16 * 1024);
    }
  });

  it("é puro: não escreve nada em disco (a 'casa' fica byte a byte igual)", () => {
    const casa = mkdtempSync(join(tmpdir(), "casa-"));
    try {
      writeFileSync(join(casa, ".claude.json"), "{}"); writeFileSync(join(casa, "config.toml"), "x=1");
      const hash = (): string => createHash("sha256").update(readdirSync(casa).sort().map((f) => f + readFileSync(join(casa, f), "utf8")).join("|")).digest("hex");
      const antes = hash();
      for (const cli of ["claude", "codex", "opencode"]) configuracaoDeMcpLoja(cli, [srv("falso-ok"), srv("falso-chave", ["FALSO_API_KEY"])], { ...ctx, userData: casa }, join(casa, "mcp.json"));
      expect(hash()).toBe(antes);
      expect(readdirSync(casa).sort()).toEqual([".claude.json", "config.toml"]);
    } finally { rmSync(casa, { recursive: true, force: true }); }
  });

  it("não usa o nome do produto literal: variáveis de loopback derivam de PRODUTO", () => {
    expect(ctx.lancador.variavelUrl.startsWith(PRODUTO.prefixoEnv)).toBe(true);
  });
});

describe("fusão com o MCP do app (D-13 intacto)", () => {
  const app = { nome: "app-mcp", url: "http://127.0.0.1:5555/mcp", variavel_token: "APP_TOKEN", token: "tok-do-pane" };
  void novaPasta;

  it("Claude: um único --mcp-config e JSON fundido; o servidor do app continua idêntico", () => {
    const so = configuracaoDeMcp("claude", app, ARQ)!;
    const loja = configuracaoDeMcpLoja("claude", [srv("falso-ok")], { ...ctx, estrito: true }, ARQ)!;
    const f = combinarConfiguracoesMcp(so, loja)!;
    expect(f.argumentos).toEqual(["--mcp-config", ARQ, "--strict-mcp-config"]);
    const j = JSON.parse(f.arquivo!) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(j.mcpServers).sort()).toEqual(["app-mcp", "ev_falso_ok"]);
    expect(j.mcpServers["app-mcp"]).toEqual((JSON.parse(so.arquivo!) as { mcpServers: Record<string, unknown> }).mcpServers["app-mcp"]);
  });

  it("Codex: flags somam; ambiente do app preservado", () => {
    const so = configuracaoDeMcp("codex", app, ARQ)!;
    const f = combinarConfiguracoesMcp(so, configuracaoDeMcpLoja("codex", [srv("falso-ok")], ctx, ARQ))!;
    expect(f.argumentos.slice(0, so.argumentos.length)).toEqual(so.argumentos);
    expect(f.argumentos.length).toBeGreaterThan(so.argumentos.length);
    expect(f.ambiente).toEqual(so.ambiente);
  });

  it("OpenCode: a variável OPENCODE_CONFIG_CONTENT é FUNDIDA (mcp do app + da Loja)", () => {
    const so = configuracaoDeMcp("opencode", app, ARQ)!;
    const f = combinarConfiguracoesMcp(so, configuracaoDeMcpLoja("opencode", [srv("falso-ok")], ctx, ARQ))!;
    const j = JSON.parse(f.ambiente["OPENCODE_CONFIG_CONTENT"]!) as { mcp: Record<string, unknown> };
    expect(Object.keys(j.mcp).sort()).toEqual(["app-mcp", "ev_falso_ok"]);
    expect(f.ambiente["APP_TOKEN"]).toBe("tok-do-pane");
    void combinarAmbientes;
  });

  it("um dos lados nulo devolve o outro", () => {
    const so = configuracaoDeMcp("claude", app, ARQ)!;
    expect(combinarConfiguracoesMcp(so, null)).toBe(so);
    expect(combinarConfiguracoesMcp(null, so)).toBe(so);
    expect(combinarConfiguracoesMcp(null, null)).toBeNull();
  });
});
