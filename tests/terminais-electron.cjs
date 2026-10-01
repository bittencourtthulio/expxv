// Prova que o node-pty real funciona no Electron (modo Node): eco, resize e SIGINT com a CLI falsa.
// Uso: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron tests/terminais-electron.cjs
"use strict";
const assert = require("node:assert");
const path = require("node:path");

const fixture = path.resolve(__dirname, "fixtures", "cli-pty.mjs");
const pty = require("node-pty");

function esperar(leitura, alvo, ms = 8000) {
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    const t = setInterval(() => {
      if (leitura().includes(alvo)) { clearInterval(t); resolve(); }
      else if (Date.now() - inicio > ms) { clearInterval(t); reject(new Error(`não apareceu ${alvo}: ${JSON.stringify(leitura().slice(-200))}`)); }
    }, 15);
  });
}

(async () => {
  const proc = pty.spawn(process.execPath, [fixture], { name: "xterm-256color", cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
  let saida = "";
  proc.onData((d) => { saida += d; });
  const saiu = new Promise((r) => proc.onExit((e) => r(e.exitCode)));
  await esperar(() => saida, "pty> ");
  proc.write("ola\r");
  await esperar(() => saida, "eco:ola");
  proc.resize(132, 43);
  proc.write("tamanho\r");
  await esperar(() => saida, "tamanho:132x43");
  proc.write("\x03");
  await esperar(() => saida, "interrompido");
  assert.strictEqual(await saiu, 0);
  console.log(JSON.stringify({ ok: true, electron: process.versions.electron ?? null, node: process.versions.node, nodePty: "eco+resize+SIGINT" }));
  process.exit(0);
})().catch((e) => { console.error("FALHA node-pty no Electron:", e && e.stack ? e.stack : e); process.exit(1); });
