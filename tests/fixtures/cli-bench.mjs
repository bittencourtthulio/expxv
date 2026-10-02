#!/usr/bin/env node
// CLI falsa do Bench (nunca toca rede, nunca é paga). Faz o papel de `claude` (-p) ou `codex` (exec). O comportamento vem do TEXTO do prompt (stdin), como em cli-headless/claude-falso.mjs:
//  (padrão)           entrega index.html com <canvas>/requestAnimationFrame e imprime o uso em JSON
//  MODO:FALHA         erro em stderr e saída 2        MODO:TIMEOUT   grava parcial.html e nunca termina
//  MODO:ESCAPE:<p>    tenta escrever em <p> e grava escape.json {escreveu}      MODO:LER:<p>   tenta ler <p> e grava leu.json {leu}
//  MODO:ENV           grava env.json com process.env    MODO:FILHO    cria um neto que dorme (grava filhos.json) e fica preso
//  MODO:GRANDE:<MB>   despeja <MB> MB em stdout          MODO:SEMCUSTO uso sem custo        MODO:JSONRUIM  saída que não é JSON
//  MODO:CORRIGIR_SOMA corrige soma.js                    MODO:PRESO    nunca termina (sem artefato)
//  MODO:LENTO:<ms>    dorme <ms> antes de entregar       MODO:JUIZ     devolve veredito JSON do juiz (nota por entrega)
// `--help` lista as flags dos dois adaptadores. CLI_FALSA_REGISTRO (arquivo) recebe {args, cwd, stdin}.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: cli [options]\n -p, --print\n --output-format <fmt>\n --permission-mode <m>\n --strict-mcp-config\n --mcp-config <c>\n --disable-slash-commands\n --no-session-persistence\n --model <m>\n --effort <e>\n --tools <t>\n --json\n --skip-git-repo-check\n --ephemeral\n -s, --sandbox <m>\n -C, --cd <dir>");
  process.exit(0);
}
let entrada = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (entrada += d));
process.stdin.on("end", async () => {
  const codex = args[0] === "exec";
  if (process.env.CLI_FALSA_REGISTRO) { try { writeFileSync(process.env.CLI_FALSA_REGISTRO, JSON.stringify({ args, cwd: process.cwd(), stdin: entrada })); } catch (e) { try { writeFileSync(process.env.CLI_FALSA_REGISTRO + ".erro" + process.pid, String(e)); } catch { /* sem registro */ } } }
  const m = (nome) => { const i = entrada.indexOf(`MODO:${nome}`); if (i < 0) return null; const r = entrada.slice(i + 5 + nome.length).match(/^:([^\s]+)/); return r ? r[1] : ""; };
  const uso = (custo = true) => {
    if (codex) console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1200, cached_input_tokens: 200, output_tokens: 500 } }));
    else console.log(JSON.stringify({ type: "result", subtype: "success", ...(custo ? { total_cost_usd: 0.0123 } : {}), num_turns: 3, usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }, result: "ok" }));
  };
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  if (m("FALHA") !== null) { console.error("falha simulada"); process.exit(2); }
  if (m("JSONRUIM") !== null) { console.log("isto não é json {{{"); process.exit(0); }
  if (m("PRESO") !== null) return void setInterval(() => undefined, 1000);
  if (m("TIMEOUT") !== null) { writeFileSync("parcial.html", "<html><body>parcial</body></html>"); return void setInterval(() => undefined, 1000); }
  if (m("FILHO") !== null) {
    const neto = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    writeFileSync("filhos.json", JSON.stringify({ pid: process.pid, neto: neto.pid }));
    return void setInterval(() => undefined, 1000);
  }
  const lento = m("LENTO");
  if (lento !== null) await dormir(Number(lento) || 100);
  const esc = m("ESCAPE");
  if (esc !== null) { let escreveu = false; try { writeFileSync(esc, "fuga"); escreveu = true; } catch { /* negado */ } writeFileSync("escape.json", JSON.stringify({ escreveu })); }
  const ler = m("LER");
  if (ler !== null) { let leu = null; try { leu = readFileSync(ler, "utf8"); } catch { /* negado */ } writeFileSync("leu.json", JSON.stringify({ leu })); }
  if (m("ENV") !== null) writeFileSync("env.json", JSON.stringify(process.env));
  const grande = m("GRANDE");
  if (grande !== null) { const bloco = "x".repeat(1024 * 1024) + "\n"; for (let i = 0; i < (Number(grande) || 1); i++) process.stdout.write(bloco); }
  if (m("CORRIGIR_SOMA") !== null) writeFileSync("soma.js", 'function somar(l){let t=0;for(let i=0;i<l.length;i++){if(typeof l[i]==="number")t+=l[i];}return t;}\nmodule.exports={somar};\n');
  if (m("JUIZ") !== null || entrada.includes("avaliador imparcial")) {
    const rotulos = [...new Set([...entrada.matchAll(/ENTREGA ([A-Z])\b/g)].map((x) => x[1]))];
    const scores = Object.fromEntries(rotulos.map((r, i) => [r, { functionality: 8 - i, visual: 7, completeness: 8 - i, robustness: 7, overall: 8 - i, rationale: "ok" }]));
    console.log(JSON.stringify({ type: "result", result: JSON.stringify({ scores, ranking: rotulos }), total_cost_usd: 0.001, num_turns: 1, usage: { input_tokens: 10, output_tokens: 10 } }));
    return;
  }
  if (!entrada.includes("MODO:SEMARQUIVO")) writeFileSync(join(process.cwd(), "index.html"), "<!doctype html><html><body><canvas id=c></canvas><script>function t(){requestAnimationFrame(t)}t()</script></body></html>");
  uso(m("SEMCUSTO") === null);
});
