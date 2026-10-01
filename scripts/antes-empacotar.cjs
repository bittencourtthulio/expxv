// beforePack do electron-builder: garante os ativos (prompts, gancho.mjs) em dist/ mesmo que o build
// tenha sido feito sem `scripts/copiar-ativos.mjs`. Idempotente.
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

exports.default = async function antesDeEmpacotar() {
  const { copiarAtivos } = await import(pathToFileURL(join(__dirname, "lib", "ativos.mjs")).href);
  copiarAtivos(join(__dirname, ".."));
};
