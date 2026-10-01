#!/usr/bin/env node
// Chamado por `npm run build:main` depois do tsc: copia prompts e scripts de hook para dist/.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copiarAtivos } from "./lib/ativos.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  const copiados = copiarAtivos(raiz);
  console.log(`ativos copiados para dist/: ${copiados.length}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
