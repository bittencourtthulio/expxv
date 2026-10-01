#!/usr/bin/env node
// `npm run verificar`: typecheck + testes + orçamentos estáticos. Falha no primeiro erro.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const etapas = [
  ["typecheck", "npm", ["run", "--silent", "typecheck"]],
  ["testes", "npx", ["vitest", "run"]],
];
if (existsSync("dist/renderer/index.html")) {
  etapas.push(["tamanho do bundle", "node", ["scripts/tamanho-bundle.mjs"]]);
}

for (const [nome, cmd, args] of etapas) {
  process.stdout.write(`\n▶ ${nome}\n`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    process.stderr.write(`\n✖ ${nome} falhou\n`);
    process.exit(r.status ?? 1);
  }
}
process.stdout.write("\n✔ verificar: tudo verde\n");
