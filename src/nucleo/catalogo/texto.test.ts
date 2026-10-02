import { describe, expect, it } from "vitest";
import { lerFrontmatterSkill } from "./frontmatter";
import { nomeValido, normalizarNome } from "./normalizar";
import { sanearNome, sanearTexto } from "./sanear";
import { detalheDeMcp, origemDaUrl, redigirMcp } from "./scanners/redacao-mcp";
import { lerMcpToml } from "./scanners/toml-minimo";
import { executavelDoHook } from "./scanners/config";

describe("normalizar", () => {
  it.each([
    ["frontend-design", "frontenddesign"], ["Frontend_Design", "frontenddesign"], ["frontend design", "frontenddesign"], ["plugin:Frontend.Design", "frontenddesign"],
    ["  A-b_c.d ", "abcd"], ["Evento:script.sh", "evento:scriptsh"], ["", ""],
  ])("%s -> %s", (a, b) => expect(normalizarNome(a)).toBe(b));
  it("nomeValido recusa caminho, maiúscula e vazio", () => {
    for (const ruim of ["", "../x", "A", "a/b", "a..b", "-a", "a b", "x".repeat(65)]) expect(nomeValido(ruim)).toBe(false);
    for (const bom of ["a", "ev-guide", "x_1.2", "0abc"]) expect(nomeValido(bom)).toBe(true);
  });
});

describe("sanear", () => {
  it("remove ANSI, bidi, zero-width e controles; colapsa espaços; trunca em code points", () => {
    expect(sanearTexto("a\u001b[31mb‮c​d\u0000e   f", 50)).toBe("abcd e f");
    expect(sanearTexto("😀😀😀😀", 2)).toBe("😀😀");
    expect(sanearTexto(42, 5)).toBe("");
    expect(sanearNome("a/b\\c")).toBe("a_b_c");
  });
  it("fuzz: 1000 entradas aleatórias nunca lançam e nunca passam do limite", () => {
    for (let i = 0; i < 1000; i++) {
      const s = Array.from({ length: Math.floor(Math.random() * 200) }, () => String.fromCharCode(Math.floor(Math.random() * 0x2100))).join("");
      expect(Array.from(sanearTexto(s, 40)).length).toBeLessThanOrEqual(40);
      expect(() => lerFrontmatterSkill(s)).not.toThrow();
      expect(() => normalizarNome(s)).not.toThrow();
    }
  });
});

describe("frontmatter", () => {
  it("lê name/description/author e tolera YAML inválido e ausência", () => {
    expect(lerFrontmatterSkill("---\nname: x\ndescription: \"a: b\"\nauthor: ana\n---\ncorpo")).toEqual({ name: "x", description: "a: b", author: "ana" });
    expect(lerFrontmatterSkill("---\nname: [quebrado\n---\n")).toEqual({});
    expect(lerFrontmatterSkill("# Titulo\n\nPrimeiro parágrafo\nsegue.\n\nOutro")).toEqual({ description: "Primeiro parágrafo segue." });
    expect(lerFrontmatterSkill("")).toEqual({});
    expect(lerFrontmatterSkill("---\nmetadata:\n  author: zé\n---\n").author).toBe("zé");
  });
  it("só olha os primeiros 8 KB", () => {
    const grande = Buffer.concat([Buffer.from("---\nname: z\n---\n"), Buffer.alloc(5 * 1024 * 1024, 65)]);
    expect(lerFrontmatterSkill(grande).name).toBe("z");
  });
});

describe("redação de MCP", () => {
  it("nunca copia valor de env/headers/args/URL", () => {
    const r = redigirMcp({ command: "/bin/x", args: ["--k", "SEGREDO1"], env: { API_KEY: "SEGREDO2", MODO: "dev" } });
    const todo = JSON.stringify([r, detalheDeMcp(r!)]);
    expect(todo).not.toContain("SEGREDO");
    expect(r).toMatchObject({ transporte: "stdio", executavel_base: "x", n_args: 2, chaves_env: ["API_KEY", "MODO"], tem_segredo: true });
    const h = redigirMcp({ type: "http", url: "https://u:SEGREDO3@h.com:8443/p?t=SEGREDO4", headers: { Authorization: "SEGREDO5", Accept: "x" } });
    expect(JSON.stringify(h)).not.toContain("SEGREDO");
    expect(h?.origem_url).toBe("https://h.com:8443");
    expect(origemDaUrl("file:///etc/passwd")).toBeNull();
    expect(origemDaUrl("x".repeat(3000))).toBeNull();
    expect(redigirMcp(5)).toBeNull();
    expect(redigirMcp({ command: ["node", "a.js"], environment: { A: "1" } })).toMatchObject({ n_args: 1, executavel_base: "node", tem_segredo: false });
  });
});

describe("TOML mínimo do Codex", () => {
  it("lê tabelas mcp_servers e descarta valores de env", () => {
    const t = `model="x"\n[mcp_servers.a]\ncommand = "uvx"\nargs = ["p", "--k=S1"]\nenv = { TOKEN = "S2", B = "y" }\n[mcp_servers."b.c"]\nurl = "https://x.com"\nbearer_token_env_var = "T"\n[mcp_servers.a.env]\nZ_KEY = "S3"\n[outra]\nx = 1\n[[tabelas]]\nk = 2\n`;
    const r = lerMcpToml(t);
    expect(r.map((x) => x.nome)).toEqual(["a", "b.c"]);
    expect(JSON.stringify(r)).not.toMatch(/S2|S3/);
    expect(r[0]?.bruto.env).toEqual({ TOKEN: true, B: true, Z_KEY: true });
    expect(lerMcpToml(t, { valores: true })[0]?.bruto.env?.["TOKEN"]).toBe("S2");
  });
  it("10 entradas quebradas nunca lançam", () => {
    for (const t of ["[mcp_servers.", "[mcp_servers.x]\nargs = [\"a\"", "[[[[", "= = =", "[mcp_servers.x]\nenv = {", "\u0000\u0001", "[mcp_servers.x]\ncommand = ", "[mcp_servers.x]\nargs = ]", "#", "[mcp_servers.x.env]\n9bad = 1"]) {
      expect(() => lerMcpToml(t)).not.toThrow();
    }
  });
});

describe("executável do hook", () => {
  it.each([
    ['bash "$HOME/.claude/hooks/guard.sh" --token abc', "guard.sh", 2],
    ['bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/expx-lembrete.sh', "expx-lembrete.sh", 0],
    ["node ./scripts/stop.js", "stop.js", 0],
    ["FOO=1 npx -y pkg a b", "pkg", 2],
    ["", null, 0],
  ])("%s", (cmd, exec, n) => expect(executavelDoHook(cmd)).toEqual({ exec, n_args: n }));
});
