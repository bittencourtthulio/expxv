import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";
import { ambienteSeguro, limparHerancaDoOrca, limparHerancaDoOrcaNoProcesso } from "./ambiente";

const CONTA_ORCA = "/Users/p/Library/Application Support/orca/codex-accounts/abc/home";
const orca = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  HOME: "/Users/p",
  PATH: ["/Users/p/.orca/claude-agent-teams-bin", "/Applications/Orca.app/Contents/Resources/bin", "/usr/bin", "/opt/homebrew/bin"].join(delimiter),
  ORCA_TAB_ID: "t", ORCA_AGENT_HOOK_TOKEN: "x", ORCA_AGENT_TEAMS_SHIM_BIN: "/Users/p/.orca/claude-agent-teams-bin/claude", ORCA_CODEX_HOME: CONTA_ORCA,
  CODEX_HOME: CONTA_ORCA,
  ...extra,
});

describe("herança do Orca (app aberto de um terminal do Orca)", () => {
  it("tira toda ORCA_*, o CODEX_HOME de contas do Orca e as pastas .orca/Orca.app do PATH", () => {
    const limpo = limparHerancaDoOrca(orca());
    expect(Object.keys(limpo).filter((k) => /^ORCA_/i.test(k))).toEqual([]);
    expect(limpo["CODEX_HOME"]).toBeUndefined();
    expect(limpo["PATH"]).toBe(["/usr/bin", "/opt/homebrew/bin"].join(delimiter));
    expect(limpo["HOME"]).toBe("/Users/p");
  });

  it("mantém a configuração da própria pessoa: CODEX_HOME próprio e PATH sem Orca ficam", () => {
    const limpo = limparHerancaDoOrca({ HOME: "/Users/p", PATH: "/usr/bin", CODEX_HOME: "/Users/p/.codex-trabalho", CLAUDE_CONFIG_DIR: "/Users/p/.claude-x" });
    expect(limpo).toEqual({ HOME: "/Users/p", PATH: "/usr/bin", CODEX_HOME: "/Users/p/.codex-trabalho", CLAUDE_CONFIG_DIR: "/Users/p/.claude-x" });
  });

  it("CODEX_HOME igual ao ORCA_CODEX_HOME sai mesmo fora do padrão de caminho", () => {
    expect(limparHerancaDoOrca({ CODEX_HOME: "/x/y", ORCA_CODEX_HOME: "/x/y" })["CODEX_HOME"]).toBeUndefined();
  });

  it("o ambiente do Pane não leva nada do Orca (ambienteSeguro)", () => {
    const amb = ambienteSeguro({ caminho: "/Users/p/.local/bin/codex" }, { origem: orca(), scrub: null, inicio: "/Users/p", plataforma: "darwin" });
    expect(Object.keys(amb).some((k) => /^ORCA_/i.test(k))).toBe(false);
    expect(amb["CODEX_HOME"]).toBeUndefined();
    expect(amb["PATH"]).not.toMatch(/\.orca|Orca\.app/);
    expect(amb["PATH"]).toContain("/usr/bin");
  });

  it("no processo: remove as variáveis do Orca no lugar e é idempotente", () => {
    const alvo = orca();
    limparHerancaDoOrcaNoProcesso(alvo);
    limparHerancaDoOrcaNoProcesso(alvo);
    expect(Object.keys(alvo).some((k) => /^ORCA_/i.test(k))).toBe(false);
    expect(alvo["CODEX_HOME"]).toBeUndefined();
    expect(alvo["PATH"]).toBe(["/usr/bin", "/opt/homebrew/bin"].join(delimiter));
  });

  it("caminhos do Windows também são reconhecidos", () => {
    const limpo = limparHerancaDoOrca({ PATH: ["C:\\Users\\p\\.orca\\bin", "C:\\Windows"].join(";"), CODEX_HOME: "C:\\Users\\p\\AppData\\Roaming\\orca\\codex-accounts\\a\\home" });
    expect(limpo["CODEX_HOME"]).toBeUndefined();
    expect(limpo["PATH"]).not.toMatch(/\.orca/i);
  });
});
