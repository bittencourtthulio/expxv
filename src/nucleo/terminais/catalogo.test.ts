import { describe, expect, it } from "vitest";
import {
  argumentosAutomaticos, argumentosDeModelo, modelosDaFerramenta, argumentosDePromptInicial, argumentosDeRetomada, CATALOGO_TERMINAIS, combinarAmbientes,
  configuracaoDeMcp, recursosDaFerramenta, teclaDeInterrupcao, type ServidorMcp,
} from "./catalogo";

describe("catálogo enxuto", () => {
  it("tem exatamente as ferramentas do MVP, na ordem", () => {
    expect(CATALOGO_TERMINAIS.map((f) => f.id)).toEqual(["terminal", "claude", "codex", "gemini", "opencode", "aider", "qwen", "kilo"]);
    expect(CATALOGO_TERMINAIS.find((f) => f.id === "kilo")?.executaveis).toEqual(["kilo", "kilocode"]);
  });
});

describe("argumentosAutomaticos (D-14)", () => {
  it("em modo seguro nunca devolve nada, para nenhuma ferramenta", () => {
    for (const f of CATALOGO_TERMINAIS) expect(argumentosAutomaticos(f.id, "seguro")).toEqual([]);
    expect(argumentosAutomaticos("personalizado", "seguro")).toEqual([]);
  });
  it("em modo automático usa as opções oficiais; o Codex nunca recebe o bypass total de sandbox", () => {
    expect(argumentosAutomaticos("claude", "automatico")).toEqual(["--dangerously-skip-permissions"]);
    expect(argumentosAutomaticos("codex", "automatico")).toEqual(["--approve-for-me"]);
    for (const f of CATALOGO_TERMINAIS) {
      expect(argumentosAutomaticos(f.id, "automatico")).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    }
    expect(argumentosAutomaticos("terminal", "automatico")).toEqual([]);
    expect(argumentosAutomaticos("personalizado", "automatico")).toEqual([]);
  });
});

describe("tecla de interrupção", () => {
  it("ESC para as CLIs de IA, Ctrl+C para shell e sem mapa", () => {
    for (const id of ["claude", "codex", "gemini", "opencode", "qwen", "kilo"]) expect(teclaDeInterrupcao(id)).toBe("\x1b");
    for (const id of ["terminal", "personalizado", "aider"]) expect(teclaDeInterrupcao(id)).toBe("\x03");
  });
});

describe("mapas de recursos", () => {
  it("retomada só para Claude e Codex, com id validado", () => {
    expect(argumentosDeRetomada("claude", "abc-1")).toEqual(["--resume", "abc-1"]);
    expect(argumentosDeRetomada("codex", "abc-1")).toEqual(["resume", "abc-1"]);
    expect(argumentosDeRetomada("gemini", "abc-1")).toBeNull();
    expect(argumentosDeRetomada("claude", "a b")).toBeNull();
  });
  it("prompt inicial e recursos da ferramenta", () => {
    expect(argumentosDePromptInicial("claude", "oi")).toEqual(["oi"]);
    expect(argumentosDePromptInicial("opencode", "oi")).toEqual(["--prompt", "oi"]);
    expect(argumentosDePromptInicial("terminal", "oi")).toBeNull();
    expect(recursosDaFerramenta("claude")).toEqual({ prompt_inicial: true, retomar: true, mcp: true, hook: true });
    expect(recursosDaFerramenta("codex")).toEqual({ prompt_inicial: true, retomar: true, mcp: true, hook: true });
    expect(recursosDaFerramenta("opencode")).toEqual({ prompt_inicial: true, retomar: false, mcp: true, hook: true });
    expect(recursosDaFerramenta("gemini")).toEqual({ prompt_inicial: false, retomar: false, mcp: false, hook: false });
    expect(recursosDaFerramenta("terminal")).toEqual({ prompt_inicial: false, retomar: false, mcp: false, hook: false });
  });
});

describe("configuração de MCP (servidor HTTP com Authorization Bearer)", () => {
  const servidor: ServidorMcp = { nome: "paineis", url: "http://127.0.0.1:4567/mcp", variavel_token: "APP_MCP_TOKEN", token: "tok123" };

  it("Claude: --mcp-config com o arquivo 0600 que leva o cabeçalho", () => {
    const c = configuracaoDeMcp("claude", servidor, "/x.json")!;
    expect(c.argumentos).toEqual(["--mcp-config", "/x.json"]);
    expect(c.ambiente).toEqual({});
    expect(JSON.parse(c.arquivo!)).toEqual({ mcpServers: { paineis: { type: "http", url: "http://127.0.0.1:4567/mcp", headers: { Authorization: "Bearer tok123" } } } });
  });
  it("Codex: -c por chave, token só no ambiente (bearer_token_env_var)", () => {
    const c = configuracaoDeMcp("codex", servidor, "/x.json")!;
    expect(c.argumentos).toEqual([
      "-c", 'mcp_servers.paineis.url="http://127.0.0.1:4567/mcp"',
      "-c", 'mcp_servers.paineis.bearer_token_env_var="APP_MCP_TOKEN"',
    ]);
    expect(c.argumentos.join(" ")).not.toContain("tok123");
    expect(c.ambiente).toEqual({ APP_MCP_TOKEN: "tok123" });
    expect(c.arquivo).toBeNull();
  });
  it("OpenCode: OPENCODE_CONFIG_CONTENT com servidor remoto e token por {env:}", () => {
    const c = configuracaoDeMcp("opencode", servidor, "/x.json")!;
    expect(c.argumentos).toEqual([]);
    const conteudo = c.ambiente["OPENCODE_CONFIG_CONTENT"]!;
    expect(conteudo).not.toContain("tok123");
    expect(JSON.parse(conteudo)).toEqual({ mcp: { paineis: { type: "remote", url: "http://127.0.0.1:4567/mcp", headers: { Authorization: "Bearer {env:APP_MCP_TOKEN}" }, enabled: true } } });
    expect(c.ambiente["APP_MCP_TOKEN"]).toBe("tok123");
  });
  it("sem suporte devolve null; nome e variável inválidos são recusados", () => {
    expect(configuracaoDeMcp("gemini", servidor, "/x.json")).toBeNull();
    expect(configuracaoDeMcp("terminal", servidor, "/x.json")).toBeNull();
    expect(() => configuracaoDeMcp("codex", { ...servidor, nome: 'a"b' }, "/x")).toThrow();
    expect(() => configuracaoDeMcp("codex", { ...servidor, variavel_token: "x y" }, "/x")).toThrow();
    expect(() => configuracaoDeMcp("codex", { ...servidor, url: "file:///etc/passwd" }, "/x")).toThrow();
  });
});

describe("combinarAmbientes", () => {
  it("funde OPENCODE_CONFIG_CONTENT (plugins somam, mcp se junta) e deixa as demais variáveis para a última", () => {
    const a = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: ["file:///a.mjs"] }), X: "1" };
    const b = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { p: { type: "remote" } } }), X: "2" };
    const r = combinarAmbientes([a, b]);
    expect(JSON.parse(r["OPENCODE_CONFIG_CONTENT"]!)).toEqual({ plugin: ["file:///a.mjs"], mcp: { p: { type: "remote" } } });
    expect(r["X"]).toBe("2");
    expect(combinarAmbientes([])).toEqual({});
  });
});

describe("modelos por CLI (lista estática)", () => {
  it("claude: aliases opus, sonnet e haiku", () => {
    expect(modelosDaFerramenta("claude").map((m) => m.modelo)).toEqual(["opus", "sonnet", "haiku"]);
  });
  it("sem valor documentado conhecido (codex, gemini) devolve só o padrão da CLI, marcado", () => {
    for (const id of ["codex", "gemini"]) {
      expect(modelosDaFerramenta(id)).toEqual([{ modelo: "default", padrao: true, niveis_esforco: [] }]);
    }
  });
  it("ferramenta sem suporte a modelo devolve lista vazia; o retorno é cópia", () => {
    expect(modelosDaFerramenta("terminal")).toEqual([]);
    modelosDaFerramenta("claude").pop();
    expect(modelosDaFerramenta("claude")).toHaveLength(3);
  });
});

describe("argumentosDeModelo (--model)", () => {
  it("vira --model <valor> nas CLIs que suportam", () => {
    for (const id of ["claude", "codex", "gemini", "opencode", "aider"]) expect(argumentosDeModelo(id, "opus")).toEqual(["--model", "opus"]);
  });
  it("CLI sem suporte, modelo vazio ou 'default' não geram flag", () => {
    expect(argumentosDeModelo("terminal", "opus")).toEqual([]);
    expect(argumentosDeModelo("claude", "")).toEqual([]);
    expect(argumentosDeModelo("claude", "default")).toEqual([]);
    expect(argumentosDeModelo("claude", null)).toEqual([]);
  });
  it("rejeita valor que pareça flag ou tenha caracteres fora do padrão (injeção de argumento)", () => {
    for (const v of ["--dangerously-skip-permissions", "-x", "a b", "a;b", "a\nb", "x".repeat(101)]) expect(argumentosDeModelo("claude", v)).toEqual([]);
    expect(argumentosDeModelo("opencode", "anthropic/claude-sonnet-4")).toEqual(["--model", "anthropic/claude-sonnet-4"]);
  });
});

describe("AUD-24: id de conversa nunca vira opção da CLI", () => {
  it("recusa id que começa com hífen em --resume/resume", () => {
    expect(argumentosDeRetomada("claude", "--dangerously-skip-permissions")).toBeNull();
    expect(argumentosDeRetomada("codex", "-c")).toBeNull();
    expect(argumentosDeRetomada("claude", "abc-123_X")).toEqual(["--resume", "abc-123_X"]);
    expect(argumentosDeRetomada("codex", "019a3c5e-7d21")).toEqual(["resume", "019a3c5e-7d21"]);
  });
});

