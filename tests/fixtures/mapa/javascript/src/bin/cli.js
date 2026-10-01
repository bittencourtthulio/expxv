#!/usr/bin/env node
const { Command } = require("commander");
const programa = new Command();

programa.command("migrar").action(() => migrar());
programa.command("limpar <alvo>").action(limpar);

function migrar() {}
function limpar() {}

if (require.main === module) {
  programa.parse(process.argv);
}
