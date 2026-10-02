// Worker FALSO do pool de extração (T-17.05): fala o mesmo protocolo do worker real, mas o comportamento
// depende do NOME do arquivo pedido. Usado só nos testes do pool.
"use strict";
const { parentPort, workerData, threadId } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");

parentPort.on("message", (msg) => {
  const nome = path.basename(msg.caminho_abs);
  const ok = () => parentPort.postMessage({ id: msg.id, ok: true, ms: 1, extracao: { hash: nome, thread: threadId, caminho: msg.caminho_abs } });
  const gira = (ms) => {
    const fim = performance.now() + ms;
    while (performance.now() < fim) { /* ocupa a CPU de propósito */ }
  };
  if (nome.startsWith("trava")) { for (;;) { /* nunca responde */ } }
  if (nome.startsWith("cai-saida")) process.exit(3);
  if (nome.startsWith("cai-erro")) { setImmediate(() => { throw new Error("falha inesperada"); }); return; }
  if (nome.startsWith("cai-uma-vez")) {
    const marcador = workerData.marcador;
    if (!fs.existsSync(marcador)) { fs.writeFileSync(marcador, "1"); process.exit(4); }
    return ok();
  }
  if (nome.startsWith("erro")) return parentPort.postMessage({ id: msg.id, ok: false, erro: "falhou de propósito", codigo: "erro" });
  const lento = /^lento(\d+)/.exec(nome);
  if (lento) return void setTimeout(ok, Number(lento[1]));
  const gira1 = /^gira(\d+)/.exec(nome);
  if (gira1) { gira(Number(gira1[1])); return ok(); }
  return ok();
});
