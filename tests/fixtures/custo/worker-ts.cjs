// Carrega `src/nucleo/custo/worker.ts` como worker thread nos testes (sem build): registra um require hook que transpila .ts com o `typescript` do projeto.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
require.extensions[".ts"] = (mod, arquivo) => {
  const saida = ts.transpileModule(fs.readFileSync(arquivo, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: arquivo });
  mod._compile(saida.outputText, arquivo);
};
require(path.resolve(__dirname, "../../../src/nucleo/custo/worker.ts"));
