#!/usr/bin/env node
// CLI falsa do Claude Code para testes do chat (nunca toca rede). Lê o prompt do stdin; modos pelo texto:
//  "MODO:ECO" ecoa; "MODO:LONGO" emite saída enorme; "MODO:PRESO" nunca termina; "MODO:ERRO" sai com 3 sem texto; "--help" lista as flags.
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: claude [options]\n --output-format <fmt>\n --include-partial-messages\n --tools <tools>\n --disable-slash-commands\n --no-session-persistence\n --system-prompt <p>");
  process.exit(0);
}
if (process.env.CLI_FALSA_REGISTRO) writeFileSync(process.env.CLI_FALSA_REGISTRO, JSON.stringify({ args, cwd: process.cwd(), env: { CLAUDECODE: process.env.CLAUDECODE ?? null, CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID ?? null } }));
let entrada = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (entrada += d));
process.stdin.on("end", () => {
  const evento = (texto) => console.log(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: texto } } }));
  if (entrada.includes("MODO:ERRO")) process.exit(3);
  if (entrada.includes("MODO:PRESO")) return void setInterval(() => undefined, 1000);
  if (entrada.includes("MODO:LONGO")) {
    const bloco = "x".repeat(65536);
    for (let i = 0; i < 40; i++) evento(bloco);
    return;
  }
  evento("Resposta ");
  evento("simulada [1].");
  console.log(JSON.stringify({ type: "result", result: "ok" }));
});
