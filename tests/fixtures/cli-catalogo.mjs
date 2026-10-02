// CLI FALSA do contrato de isolamento (Fase 7, T-07.25): faz o que o Claude Code faz com o `settings.json` do Pane diante de uma chamada de ferramenta —
// confere `permissions.deny` e dispara os hooks `PreToolUse` cujo matcher casa com a ferramenta (stdin = JSON do hook; env = o do Pane). Bloqueia com saída 2 ou
// `permissionDecision: "deny"`. Aceita (e ignora) `--dangerously-skip-permissions`: hook e `deny` valem mesmo assim, como na CLI real.
// Uso: node cli-catalogo.mjs --settings <arquivo> --tool <nome> [--input <json>] [--dangerously-skip-permissions]
// Saída (stdout, uma linha JSON): { blocked: boolean, by: "deny"|"hook"|null, reason: string|null }
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const pega = (nome) => { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : undefined; };
const settings = JSON.parse(readFileSync(pega("--settings"), "utf8"));
const tool = pega("--tool") ?? "";
const entrada = JSON.parse(pega("--input") ?? "{}");

function negadoPorRegra() {
  const regras = settings.permissions?.deny ?? [];
  for (const r of regras) {
    if (r === tool) return r;
    const m = /^([A-Za-z_]+)\((.*)\)$/.exec(r);
    if (m && m[1] === tool && (entrada.skill === m[2] || entrada.name === m[2])) return r;
    if (/^mcp__[A-Za-z0-9_-]+$/.test(r) && tool.startsWith(`${r}__`)) return r;
  }
  return null;
}

const regra = negadoPorRegra();
if (regra !== null) {
  console.log(JSON.stringify({ blocked: true, by: "deny", reason: `regra ${regra}` }));
  process.exit(0);
}
for (const h of settings.hooks?.PreToolUse ?? []) {
  if (!new RegExp(`^(${h.matcher ?? ".*"})$`).test(tool)) continue;
  for (const hook of h.hooks ?? []) {
    const r = spawnSync("sh", ["-c", hook.command], { input: JSON.stringify({ tool_name: tool, tool_input: entrada }), env: process.env, encoding: "utf8", timeout: 15000 });
    let decisao = null;
    try { decisao = JSON.parse(r.stdout || "{}")?.hookSpecificOutput?.permissionDecision ?? null; } catch { /* saída não é JSON */ }
    if (r.status === 2 || r.status === null || decisao === "deny") {
      let motivo = null;
      try { motivo = JSON.parse(r.stdout || "{}")?.hookSpecificOutput?.permissionDecisionReason ?? null; } catch { /* sem motivo */ }
      console.log(JSON.stringify({ blocked: true, by: "hook", reason: motivo ?? (r.stderr || "hook bloqueou").trim() }));
      process.exit(0);
    }
  }
}
console.log(JSON.stringify({ blocked: false, by: null, reason: null }));
