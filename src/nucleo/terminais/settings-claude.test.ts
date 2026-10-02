import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ajustarArgumentosDasSessoes, juntarSettingsDoClaude } from "./settings-claude";

function dois() {
  const dir = mkdtempSync(join(tmpdir(), "settings-"));
  const a = join(dir, "a.json");
  const b = join(dir, "b.json");
  writeFileSync(a, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "http", url: "http://x" }] }], Notification: [{ hooks: [] }] } }));
  writeFileSync(b, JSON.stringify({ managed: true, hooks: { Stop: [{ hooks: [{ type: "command", command: "c" }] }], PreToolUse: [{ hooks: [] }] } }));
  return { dir, a, b };
}

describe("juntar --settings do Claude", () => {
  it("dois --settings viram um, somando os hooks de cada evento", () => {
    const { dir, a, b } = dois();
    const saida = juntarSettingsDoClaude(["--x", "--settings", a, "--mcp-config", "m.json", "--settings", b, "prompt"]);
    const destino = join(dir, "claude-settings-juntas.json");
    expect(saida).toEqual(["--x", "--mcp-config", "m.json", "--settings", destino, "prompt"]);
    const json = JSON.parse(readFileSync(destino, "utf8")) as { managed: boolean; hooks: Record<string, unknown[]> };
    expect(json.managed).toBe(true);
    expect(json.hooks["Stop"]).toHaveLength(2);
    expect(Object.keys(json.hooks).sort()).toEqual(["Notification", "PreToolUse", "Stop"]);
  });
  it("o --settings juntado separa o --mcp-config (variádico) do prompt posicional", () => {
    const { a, b } = dois();
    const saida = juntarSettingsDoClaude(["--settings", a, "--mcp-config", "m.json", "--settings", b, "Execute o card t-1"]);
    expect(saida.slice(-3)).toEqual(["--settings", expect.stringContaining("claude-settings-juntas.json"), "Execute o card t-1"]);
    expect(saida[saida.indexOf("--mcp-config") + 2]).toBe("--settings");
  });
  it("as regras de permissão SOMAM: um deny nunca apaga o deny do outro (gate de módulos desligados + piso do Maestro)", () => {
    const dir = mkdtempSync(join(tmpdir(), "settings-"));
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    writeFileSync(a, JSON.stringify({ permissions: { deny: ["Bash(git push --force*)"], allow: ["Read"] } }));
    writeFileSync(b, JSON.stringify({ permissions: { deny: ["Skill(legadox)", "Bash(git push --force*)"] } }));
    const saida = juntarSettingsDoClaude(["--settings", a, "--settings", b]);
    const json = JSON.parse(readFileSync(saida[saida.indexOf("--settings") + 1] as string, "utf8")) as { permissions: { deny: string[]; allow: string[] } };
    expect(json.permissions.deny).toEqual(["Bash(git push --force*)", "Skill(legadox)"]);
    expect(json.permissions.allow).toEqual(["Read"]);
  });
  it("só um dos arquivos tem permissions: vale o dele", () => {
    const dir = mkdtempSync(join(tmpdir(), "settings-"));
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    writeFileSync(a, JSON.stringify({ hooks: {} }));
    writeFileSync(b, JSON.stringify({ permissions: { deny: ["Skill(legadox)"] } }));
    const saida = juntarSettingsDoClaude(["--settings", a, "--settings", b]);
    expect((JSON.parse(readFileSync(saida[saida.indexOf("--settings") + 1] as string, "utf8")) as { permissions: { deny: string[] } }).permissions.deny).toEqual(["Skill(legadox)"]);
  });
  it("um só --settings (ou nenhum) não muda nada", () => {
    const { a } = dois();
    expect(juntarSettingsDoClaude(["--settings", a, "p"])).toEqual(["--settings", a, "p"]);
    expect(juntarSettingsDoClaude(["p"])).toEqual(["p"]);
  });
  it("arquivo ilegível devolve o argv intacto", () => {
    const { a } = dois();
    const argv = ["--settings", a, "--settings", "/nao/existe.json"];
    expect(juntarSettingsDoClaude(argv)).toEqual(argv);
  });
  it("só mexe no Claude", () => {
    const { a, b } = dois();
    const argv = ["--settings", a, "--settings", b];
    expect(ajustarArgumentosDasSessoes("codex", argv)).toBe(argv);
    expect(ajustarArgumentosDasSessoes("claude", argv)).not.toEqual(argv);
  });
});
