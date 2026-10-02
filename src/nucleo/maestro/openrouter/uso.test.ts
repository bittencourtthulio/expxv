import { describe, expect, it } from "vitest";
import { ambienteDoOpenRouter, argumentosDoOpenRouter, CLIS_DO_METODO_COM_OPENROUTER, CLIS_OPENROUTER, idOpenRouterValido, prevoo, URL_OPENROUTER } from "./uso";
import { harnessDaCli } from "../../metodo/comandos";

describe("ids de modelo do OpenRouter", () => {
  it.each(["anthropic/claude-sonnet-4", "openai/gpt-5:free", "meta-llama/llama-3.1-8b-instruct", "google/gemini-2.5-pro"])("%s é válido", (id) => expect(idOpenRouterValido(id)).toBe(true));
  it.each(["sonnet", "--rm/-rf", "a b/c", "/x", "a/", "-x/y", "a/b --flag", "a/--b", `a/${"x".repeat(120)}`, "../etc/passwd", null, 3, "a/b\nc"])("%j é recusado", (id) => expect(idOpenRouterValido(id)).toBe(false));
});

describe("argv por CLI", () => {
  it("opencode e aider: --model openrouter/<id>; claude por gateway: --model <id> com aviso; codex: provider custom", () => {
    expect(argumentosDoOpenRouter("opencode", "anthropic/claude-sonnet-4")).toMatchObject({ suportado: true, argv: ["--model", "openrouter/anthropic/claude-sonnet-4"] });
    expect(argumentosDoOpenRouter("aider", "x/y").argv).toEqual(["--model", "openrouter/x/y"]);
    const c = argumentosDoOpenRouter("claude", "x/y");
    expect(c.argv).toEqual(["--model", "x/y"]);
    expect(c.avisos.join(" ")).toMatch(/desliga o login por assinatura/);
    const x = argumentosDoOpenRouter("codex", "x/y");
    expect(x.argv).toContain('model_provider="openrouter"');
    expect(x.argv).toContain(`model_providers.openrouter.base_url="${URL_OPENROUTER}"`);
    expect(x.argv.slice(-2)).toEqual(["--model", "x/y"]);
    expect(x.avisos.join(" ")).toMatch(/--help/);
  });
  it("goose/kilo/cline pela configuração própria; demais CLIs indisponíveis; id inválido nunca vira argv", () => {
    for (const c of ["goose", "kilo", "cline"]) expect(argumentosDoOpenRouter(c, "x/y")).toMatchObject({ suportado: true, argv: [], configuracao_propria: true });
    for (const c of ["gemini", "qwen", "outra"]) expect(argumentosDoOpenRouter(c, "x/y")).toMatchObject({ suportado: false, argv: [] });
    for (const c of CLIS_OPENROUTER) expect(argumentosDoOpenRouter(c, "--injecao")).toMatchObject({ suportado: false, argv: [] });
    for (const c of CLIS_OPENROUTER) for (const a of argumentosDoOpenRouter(c, "x/y").argv) expect(a).not.toMatch(/\s;|\||&&|\n/);
  });
  it("no método só opencode e claude (os que executam os comandos)", () => {
    for (const c of CLIS_OPENROUTER) expect(CLIS_DO_METODO_COM_OPENROUTER.includes(c)).toBe(harnessDaCli(c) !== null);
  });
});

describe("ambiente do Pane: entrada sensível nunca vai", () => {
  const SENTINELA = "chave-SENTINELA-123";
  it("sensível ⇒ vazio, mesmo com o workspace injetando", () => {
    for (const c of CLIS_OPENROUTER) expect(ambienteDoOpenRouter(c, { valor: SENTINELA, sensivel: true }, true)).toEqual({});
  });
  it("não sensível só entra se o workspace ligou `injetar_cofre_no_env`", () => {
    expect(ambienteDoOpenRouter("opencode", { valor: "k", sensivel: false }, false)).toEqual({});
    expect(ambienteDoOpenRouter("opencode", { valor: "k", sensivel: false }, true)).toEqual({ OPENROUTER_API_KEY: "k" });
    expect(ambienteDoOpenRouter("claude", { valor: "k", sensivel: false }, true)).toEqual({ ANTHROPIC_BASE_URL: "https://openrouter.ai/api", ANTHROPIC_AUTH_TOKEN: "k" });
    expect(ambienteDoOpenRouter("gemini", { valor: "k", sensivel: false }, true)).toEqual({});
    expect(ambienteDoOpenRouter("claude", null, true)).toEqual({});
    expect(ambienteDoOpenRouter("claude", { valor: "", sensivel: false }, true)).toEqual({});
  });
});

describe("pré-voo: só avisa, nunca bloqueia, nunca lê credencial", () => {
  const ok = { chave_no_cofre: true, workspace_injeta: true, cli_instalada: true, modelo_habilitado: true };
  it("perfil sem OpenRouter ⇒ sem avisos", () => expect(prevoo({ cli: "claude", modelo: null, origem_modelo: "cli" }, { ...ok, cli_instalada: false })).toEqual([]));
  it("lista exatamente o que falta", () => {
    const p = { cli: "claude", modelo: "x/y", origem_modelo: "openrouter" as const };
    expect(prevoo(p, ok).join(" ")).toMatch(/desliga o login/);
    expect(prevoo(p, { ...ok, cli_instalada: false })[0]).toMatch(/não está instalada/);
    expect(prevoo(p, { ...ok, modelo_habilitado: false }).join(" ")).toMatch(/não está habilitado/);
    expect(prevoo(p, { ...ok, chave_no_cofre: false }).join(" ")).toMatch(/Não há chave/);
    expect(prevoo(p, { ...ok, workspace_injeta: false }).join(" ")).toMatch(/não injeta a chave/);
    expect(prevoo({ cli: "opencode", modelo: "x/y", origem_modelo: "openrouter" }, ok).join(" ")).toMatch(/Autentique opencode.*não lê credenciais/);
  });
});
