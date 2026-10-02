#!/usr/bin/env node
// Chamado por `npm run build:main` depois do tsc: copia prompts e scripts de hook para dist/.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copiarAtivos } from "./lib/ativos.mjs";
import { gerarManifestoMcp } from "./lib/manifesto-mcp.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  const copiados = copiarAtivos(raiz);
  console.log(`ativos copiados para dist/: ${copiados.length}`);
  // D-141: manifesto sha256 do seed da Loja de MCPs (o main abre a Loja só em leitura se o seed empacotado divergir)
  console.log(`manifesto do seed da Loja de MCPs: ${gerarManifestoMcp(raiz).slice(0, 12)}…`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
