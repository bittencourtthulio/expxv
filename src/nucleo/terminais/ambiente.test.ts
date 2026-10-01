import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ambienteSeguro, combinarAmbiente, VARIAVEIS_DE_IDENTIDADE } from "./ambiente";

const exe = (caminho = process.execPath) => ({ caminho });

describe("ambienteSeguro", () => {
  it("remove toda variável de identidade da sessão do Claude Code e mantém a configuração da pessoa", () => {
    const origem: NodeJS.ProcessEnv = { PATH: "/usr/bin", HOME: "/h", CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_API_KEY: "k" };
    for (const v of VARIAVEIS_DE_IDENTIDADE) origem[v] = "x";
    const ambiente = ambienteSeguro(exe(), { origem, inicio: mkdtempSync(join(tmpdir(), "amb-")) });
    for (const v of VARIAVEIS_DE_IDENTIDADE) expect(ambiente[v]).toBeUndefined();
    expect(VARIAVEIS_DE_IDENTIDADE).toEqual(expect.arrayContaining(["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_PID", "ELECTRON_RUN_AS_NODE"]));
    expect(ambiente["CLAUDE_CODE_USE_BEDROCK"]).toBe("1");
    expect(ambiente["HOME"]).toBe("/h");
  });

  it("completa o PATH: pasta do executável, ~/.local/bin, volta, bun, homebrew e sem duplicar", () => {
    const inicio = mkdtempSync(join(tmpdir(), "amb-"));
    const ambiente = ambienteSeguro(exe("/opt/x/bin/claude"), { origem: { PATH: ["/usr/bin", "/usr/local/bin"].join(delimiter) }, inicio });
    const pastas = ambiente["PATH"]!.split(delimiter);
    expect(pastas).toEqual(expect.arrayContaining([dirname("/opt/x/bin/claude"), join(inicio, ".local", "bin"), join(inicio, ".volta", "bin"), join(inicio, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"]));
    expect(new Set(pastas).size).toBe(pastas.length);
  });

  it("inclui as versões do nvm e prioriza a versão do próprio executável", () => {
    const inicio = mkdtempSync(join(tmpdir(), "amb-"));
    mkdirSync(join(inicio, ".nvm", "versions", "node", "v20.1.0"), { recursive: true });
    const caminho = join(inicio, ".nvm", "versions", "node", "v22.0.0", "bin", "codex");
    const ambiente = ambienteSeguro(exe(caminho), { origem: { PATH: "/usr/bin" }, inicio, plataforma: process.platform });
    const pastas = ambiente["PATH"]!.split(delimiter);
    expect(pastas[0]).toBe(join(inicio, ".nvm", "versions", "node", "v22.0.0", "bin"));
    expect(pastas).toContain(join(inicio, ".nvm", "versions", "node", "v20.1.0", "bin"));
  });

  it("inclui no PATH o runtime necessário para CLIs Node fora do PATH do Electron", () => {
    expect(ambienteSeguro(exe()).PATH?.split(delimiter)).toContain(dirname(process.execPath));
  });

  it("no Windows espelha PATH em Path", () => {
    const ambiente = ambienteSeguro(exe("C:\\x\\a.exe"), { origem: { Path: "C:\\Windows" }, inicio: "C:\\Users\\u", plataforma: "win32" });
    expect(ambiente["Path"]).toBe(ambiente["PATH"]);
  });
});

describe("combinarAmbiente", () => {
  it("soma o OPENCODE_CONFIG_CONTENT dos dois sem sobrescrever", () => {
    const r = combinarAmbiente({ OPENCODE_CONFIG_CONTENT: '{"plugin":["a"]}', A: "1" }, { OPENCODE_CONFIG_CONTENT: '{"mcp":{"x":{}}}', B: "2" });
    expect(JSON.parse(r["OPENCODE_CONFIG_CONTENT"]!)).toEqual({ plugin: ["a"], mcp: { x: {} } });
    expect(r).toMatchObject({ A: "1", B: "2" });
    expect(combinarAmbiente({ A: "1" }, { A: "2" })).toEqual({ A: "2" });
  });
});
