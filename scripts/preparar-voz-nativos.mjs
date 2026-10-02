#!/usr/bin/env node
// `npm run preparar:voz -- <mac|win|local>`: garante em node_modules os pacotes nativos do reconhecimento de voz local para o alvo do empacotamento (D-544). Não roda no `npm install` normal.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { comandoInstalar, pacotesFaltando } from "./lib/voz-nativos.mjs";

const alvo = process.argv[2] ?? "local";
const raiz = resolve(import.meta.dirname, "..");
const faltando = pacotesFaltando(alvo, raiz);
const c = comandoInstalar(faltando);
if (c === null) {
  process.stdout.write(`voz local: pacotes nativos de "${alvo}" já presentes\n`);
  process.exit(0);
}
process.stdout.write(`voz local: instalando ${faltando.join(", ")} (só para empacotar; não altera o package.json)\n`);
const r = spawnSync(c.cmd, c.args, { cwd: raiz, stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
