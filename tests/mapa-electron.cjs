// Prova, DENTRO do Electron real (ELECTRON_RUN_AS_NODE=1), que o mapa lógico do código funciona (T-17.02/05/06/07):
// o runtime web-tree-sitter 0.27.0 abre as 11 gramáticas de @vscode/tree-sitter-wasm 0.3.1, o extrator TypeScript
// parseia um arquivo e o pool de worker_threads extrai arquivos reais numa thread fora do main.
// Uso: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/mapa-electron.cjs <pasta-do-js-compilado> <pasta-de-fixtures-typescript>
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const [dist, fixtures] = process.argv.slice(2);
if (!dist || !fixtures) {
  console.error("uso: mapa-electron.cjs <dist> <fixtures-typescript>");
  process.exit(2);
}
const mapa = path.join(dist, "nucleo", "mapa");
const gram = require(path.join(mapa, "gramaticas.js"));
const lings = require(path.join(mapa, "linguagens.js"));
const registro = require(path.join(mapa, "extratores", "registro.js"));
const { criarPool } = require(path.join(mapa, "pool.js"));

const AMOSTRA = {
  typescript: "const olá: string = 'olá';",
  tsx: "const a = <b>olá</b>;",
  javascript: "const olá = 'olá';",
  python: "olá = 'olá'\n",
  java: 'class Ola { String s = "olá"; }',
  php: "<?php $ola = 'olá';",
  "c-sharp": 'class Ola { string s = "olá"; }',
  go: 'package ola\nvar s = "olá"\n',
  ruby: "ola = 'olá'\n",
  rust: 'fn ola() { let s = "olá"; }',
  cpp: 'int main() { const char* s = "olá"; }',
};
const LING_DA_GRAMATICA = { "c-sharp": "csharp" };

async function main() {
  const t0 = performance.now();
  await gram.iniciarRuntime();
  const runtimeMs = performance.now() - t0;
  const tempos = {};
  for (const g of lings.GRAMATICAS_EMBARCADAS) {
    const t = performance.now();
    const lang = await gram.carregarGramaticaPorNome(g);
    tempos[g] = +(performance.now() - t).toFixed(1);
    assert.ok(lang.abiVersion >= 13, `ABI de ${g}`);
    const parser = await gram.obterParser(LING_DA_GRAMATICA[g] || g);
    const arvore = parser.parse(AMOSTRA[g]);
    assert.strictEqual(arvore.rootNode.hasError, false, `erro de sintaxe ao parsear a amostra de ${g}`);
    arvore.delete();
  }
  assert.deepStrictEqual(gram.gramaticasCarregadas(), [...lings.GRAMATICAS_EMBARCADAS]);

  // extrator TypeScript (execução direta, na thread do script)
  const arquivo = path.join(fixtures, "src", "servico.ts");
  const texto = fs.readFileSync(arquivo, "utf8");
  const e = await registro.extrairArquivo(texto, "typescript", "src/servico.ts");
  assert.ok(e.simbolos.some((s) => s.qualificado === "Servico.listar" && s.tipo === "metodo"), "símbolo Servico.listar");
  assert.ok(e.imports.some((i) => i.especificador === "./util"), "import ./util");
  assert.strictEqual(e.erros_parse, 0);

  // pool de worker_threads (thread real, no Electron)
  const pool = criarPool({ caminhoWorker: path.join(mapa, "worker-extracao.js"), tamanho: 2 });
  try {
    const nomes = ["servico.ts", "rotas.ts", "dados.ts", "componente.tsx"];
    const tarefas = nomes.map((n) => ({ caminho_abs: path.join(fixtures, "src", n), caminho: `src/${n}`, linguagem: n.endsWith(".tsx") ? "tsx" : "typescript" }));
    const t1 = performance.now();
    const rs = await pool.executarLote(tarefas);
    const poolMs = performance.now() - t1;
    rs.forEach((r, i) => assert.ok(r.ok, `${nomes[i]}: ${r.erro}`));
    assert.strictEqual(rs[0].extracao.hash, e.hash, "hash/extração pela thread igual ao da execução direta");
    assert.ok(rs[1].extracao.entradas.some((x) => x.chave === "GET /users/:id"), "rota Express extraída na thread");
    assert.ok(pool.vivos > 0 && pool.vivos <= 2);
    await pool.encerrar();
    assert.strictEqual(pool.vivos, 0);
    console.log(JSON.stringify({ ok: true, electron: process.versions.electron, node: process.versions.node, abi: "web-tree-sitter 0.27.0", runtime_ms: +runtimeMs.toFixed(1), load_ms: tempos, pool_ms: +poolMs.toFixed(1), simbolos: e.simbolos.length }));
  } finally {
    await pool.encerrar();
  }
}

main().then(
  () => process.exit(0),
  (erro) => {
    console.error("FALHA mapa no Electron:", erro && erro.stack ? erro.stack : erro);
    process.exit(1);
  },
);
