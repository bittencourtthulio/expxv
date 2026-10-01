import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { montarAmbienteServidor, pathMinimo, variavelReservada } from "./ambiente";
import type { VariavelMcp } from "./esquema";
import { carregarCatalogo } from "./catalogo";
import { abrirSessao, derrubarTodos } from "../../../tests/fixtures/mcp-loja/servidores";
import { handshake } from "./verificacao";

afterEach(async () => { await derrubarTodos(); });

const decl = (nome: string, secreta: boolean, obrigatoria = false): VariavelMcp => ({ nome, secreta, obrigatoria, ajuda: "x", onde_conseguir: null });
// valores falsos e obviamente de teste (todos contêm a palavra "falso")
const SUJA: NodeJS.ProcessEnv = {
  PATH: "/usr/local/bin:/home/x/.pasta-privada/bin", HOME: "/home/x", LANG: "pt_BR.UTF-8", TMPDIR: "/tmp",
  ANTHROPIC_API_KEY: "falso-anthropic", OPENAI_API_KEY: "falso-openai", GITHUB_TOKEN: "falso-github",
  NPM_TOKEN: "falso-npm", CLAUDECODE: "1", NODE_OPTIONS: "--require /x.js", LD_PRELOAD: "/x.so", AWS_SECRET_ACCESS_KEY: "falso-aws",
  EXPXV_LOJA_TOKEN: "falso-token-do-pane", AWS_PROFILE: "dev", DATABASE_URL: "falso-url-do-banco",
};

describe("ambiente por allowlist", () => {
  it("só entra a base do sistema e o PATH mínimo; nada do ambiente do app/CLI vaza", () => {
    const { variaveis, nomes } = montarAmbienteServidor({ origem: SUJA, plataforma: "darwin" });
    expect(nomes).toEqual(["LANG", "PATH", "TMPDIR"]);
    expect(variaveis["PATH"]).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
    expect(variaveis["PATH"]).not.toContain("privada");
    const bruto = JSON.stringify(variaveis);
    expect(bruto).not.toContain("falso");
    expect(bruto).not.toContain("--require");
  });

  it("HOME só entra isolado; sem isso nem HOME nem USERPROFILE são repassados", () => {
    expect(montarAmbienteServidor({ origem: SUJA, plataforma: "darwin" }).variaveis["HOME"]).toBeUndefined();
    const iso = montarAmbienteServidor({ origem: SUJA, plataforma: "darwin", homeIsolado: "/dados/mcp/x/home" });
    expect(iso.variaveis["HOME"]).toBe("/dados/mcp/x/home");
    const win = montarAmbienteServidor({ origem: { SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\x" }, plataforma: "win32", homeIsolado: "D:\\h" });
    expect(win.variaveis["USERPROFILE"]).toBe("D:\\h");
    expect(win.variaveis["SystemRoot"]).toBe("C:\\Windows");
  });

  it("declaradas: secreta só vem do cofre; não secreta pode vir da origem; valores de variável não declarada são ignorados", () => {
    const { variaveis } = montarAmbienteServidor({
      origem: SUJA, plataforma: "darwin",
      declaradas: [decl("DATABASE_URL", true), decl("AWS_PROFILE", false), decl("TOKEN_X", true)],
      valores: { TOKEN_X: "do-cofre", NAO_DECLARADA: "x" },
    });
    expect(variaveis["TOKEN_X"]).toBe("do-cofre");
    expect(variaveis["AWS_PROFILE"]).toBe("dev");
    expect(variaveis["DATABASE_URL"]).toBeUndefined();
    expect(variaveis["NAO_DECLARADA"]).toBeUndefined();
  });

  it("reservadas nunca entram, nem declaradas nem com valor do cofre", () => {
    const nomes = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "PATH", "HOME", "NPM_TOKEN", "EXPXV_X", "ELECTRON_RUN_AS_NODE"];
    const r = montarAmbienteServidor({
      origem: SUJA, plataforma: "darwin", declaradas: nomes.map((n) => decl(n, false)),
      valores: Object.fromEntries(nomes.map((n) => [n, "malicioso"])),
    });
    expect(r.recusadas.sort()).toEqual([...nomes].sort());
    expect(Object.values(r.variaveis)).not.toContain("malicioso");
    expect(r.variaveis["PATH"]).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("valor vazio, com NUL ou gigante é descartado", () => {
    const r = montarAmbienteServidor({ origem: SUJA, plataforma: "darwin", declaradas: [decl("A_X", true), decl("B_X", true), decl("C_X", true)], valores: { A_X: "", B_X: "a\0b", C_X: "x".repeat(5000) } });
    expect(r.variaveis["A_X"]).toBeUndefined();
    expect(r.variaveis["B_X"]).toBeUndefined();
    expect(r.variaveis["C_X"]).toBeUndefined();
  });

  it("pathExtra entra antes do mínimo; Windows usa System32", () => {
    expect(pathMinimo("darwin", {}, ["/opt/node/bin"])).toBe("/opt/node/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    expect(pathMinimo("win32", { SystemRoot: "C:\\Windows" })).toBe("C:\\Windows\\System32;C:\\Windows");
  });

  it("variavelReservada cobre a lista e é insensível a caixa", () => {
    expect(variavelReservada("anthropic_api_key")).toBe(true);
    expect(variavelReservada("CONTEXT7_API_KEY")).toBe(false);
    expect(variavelReservada("GITHUB_PERSONAL_ACCESS_TOKEN")).toBe(false);
  });

  it("nenhuma variável declarada pelo seed é recusada", () => {
    const cat = carregarCatalogo(join(__dirname, "..", "..", "..", "resources", "mcp", "catalogo-mcps.json"));
    for (const x of cat.entradas) {
      const r = montarAmbienteServidor({ origem: {}, plataforma: "darwin", declaradas: x.entrada.variaveis });
      expect(r.recusadas, x.entrada.id).toEqual([]);
    }
  });

  it("servidor falso que lê o ambiente inteiro só enxerga a allowlist + declaradas (segredos do app nunca vazam)", async () => {
    const { variaveis } = montarAmbienteServidor({
      origem: { ...process.env, ...SUJA, PATH: process.env["PATH"] }, plataforma: process.platform,
      declaradas: [decl("FALSO_DECLARADA", true)], valores: { FALSO_DECLARADA: "valor-do-cofre" },
      pathExtra: [process.execPath.replace(/[/\\][^/\\]+$/, "")],
    });
    const s = await abrirSessao("eco-ambiente", variaveis);
    await handshake(s);
    const r = (await s.pedir("tools/call", { name: "listar_ambiente", arguments: {} })) as { content: Array<{ text: string }> };
    const vistos = JSON.parse(r.content[0]!.text) as string[];
    const permitidos = new Set([...Object.keys(variaveis), "__CF_USER_TEXT_ENCODING"]);
    for (const v of vistos) expect(permitidos.has(v), v).toBe(true);
    for (const proibido of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "NPM_TOKEN", "CLAUDECODE", "EXPXV_LOJA_TOKEN", "NODE_OPTIONS", "AWS_SECRET_ACCESS_KEY", "HOME"]) expect(vistos).not.toContain(proibido);
    expect(vistos).toContain("FALSO_DECLARADA");
  });
});
