#!/usr/bin/env node
// CLI falsa do Claude Code para os testes do ASSISTENTE DE EXECUÇÃO (nunca toca rede). Lê o prompt do stdin e responde conforme um ROTEIRO:
//   CLI_FALSA_ROTEIRO = caminho de um JSON `[{ texto?: string, sair?: number, preso?: boolean }, ...]`; a n-ésima chamada usa o n-ésimo passo (o último se acabar).
//   CLI_FALSA_CONTADOR = arquivo onde conta as chamadas; CLI_FALSA_REGISTRO = arquivo onde grava { args, cwd, stdin, chamadas } (um por chamada).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: claude [options]\n --output-format <fmt>\n --include-partial-messages\n --tools <tools>\n --disable-slash-commands\n --no-session-persistence\n --system-prompt <p>");
  process.exit(0);
}
let entrada = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (entrada += d));
process.stdin.on("end", () => {
  const contador = process.env.CLI_FALSA_CONTADOR;
  let n = 0;
  if (contador) {
    n = existsSync(contador) ? Number(readFileSync(contador, "utf8")) : 0;
    writeFileSync(contador, String(n + 1));
  }
  if (process.env.CLI_FALSA_REGISTRO) appendFileSync(process.env.CLI_FALSA_REGISTRO, `${JSON.stringify({ n, args, cwd: process.cwd(), stdin: entrada })}\n`);
  const roteiro = process.env.CLI_FALSA_ROTEIRO ? JSON.parse(readFileSync(process.env.CLI_FALSA_ROTEIRO, "utf8")) : [{ texto: "{}" }];
  const passo = roteiro[Math.min(n, roteiro.length - 1)];
  if (passo.preso) return void setInterval(() => undefined, 1000);
  if (passo.texto !== undefined) {
    const evento = (texto) => console.log(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: texto } } }));
    const t = passo.texto;
    for (let i = 0; i < t.length; i += 400) evento(t.slice(i, i + 400));
    console.log(JSON.stringify({ type: "result", result: "ok" }));
  }
  process.exit(passo.sair ?? 0);
});
