#!/usr/bin/env node
// `npm run verificar:fuses -- [--perfil local|release|perf] [--app dist-app/mac-<arch>/<App>.app]`: lê o binário empacotado (SÓ LEITURA) e
// confere cada fuse esperada pelo perfil. Sai com 1 e lista as divergências se alguma não bater.
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { verificarFuses } from "./lib/fuses.mjs";

const argv = process.argv.slice(2);
const pega = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const perfil = pega("perfil") ?? "local";

function acharApp() {
  const dir = resolve("dist-app");
  if (!existsSync(dir)) return null;
  for (const sub of readdirSync(dir).filter((n) => n.startsWith("mac"))) {
    const app = readdirSync(join(dir, sub)).find((n) => n.endsWith(".app"));
    if (app) return join(dir, sub, app);
  }
  const win = readdirSync(dir).find((n) => n.startsWith("win") && existsSync(join(dir, n)));
  return win ? join(dir, win) : null;
}

try {
  const app = pega("app") ?? acharApp();
  if (app === null || app === undefined) throw new Error("nenhum pacote em dist-app/ (rode npm run dist:dir antes ou informe --app)");
  const r = await verificarFuses(resolve(app), perfil);
  if (r.ok) {
    console.log(`fuses conferidos no perfil ${perfil}: ok`);
  } else {
    for (const d of r.divergencias) console.error(`fuse ${d.fuse}: esperado ${d.esperado}, encontrado ${d.atual}`);
    console.error(`fuses divergem do perfil ${perfil}`);
    process.exit(1);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : "falha ao ler os fuses");
  process.exit(1);
}
