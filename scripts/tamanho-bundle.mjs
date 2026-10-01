// P-08: JS inicial do renderer (só o que o index.html referencia, sem chunks lazy) <= 350 KB gzip.
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(RAIZ, "dist/renderer");
const LIMITE_KB = 350;

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/renderer/index.html não existe. Rode `npx vite build` antes.");
  process.exit(1);
}
const html = readFileSync(join(DIST, "index.html"), "utf8");
const refs = new Set();
for (const m of html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+\.m?js)"[^>]*>/g)) refs.add(m[1]);

let total = 0;
const linhas = [];
for (const ref of refs) {
  const arquivo = join(DIST, ref.replace(/^\.?\//, ""));
  const bruto = readFileSync(arquivo);
  const gz = gzipSync(bruto, { level: 9 }).length;
  total += gz;
  linhas.push({ arquivo: ref, "bytes": bruto.length, "gzip KB": +(gz / 1024).toFixed(1) });
}
const totalKb = total / 1024;
// `--json`: só mede e imprime {"kb":N} (quem registra é tests/perf/bundle.perf.ts, via registro.ts → ultimo.json).
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ kb: +totalKb.toFixed(2), arquivos: refs.size, limite_kb: LIMITE_KB }));
  process.exit(0);
}
console.table(linhas);
console.log(`JS inicial gzip: ${totalKb.toFixed(1)} KB (limite ${LIMITE_KB} KB)`);
if (refs.size === 0 || totalKb > LIMITE_KB) {
  console.error(refs.size === 0 ? "Nenhum JS referenciado no index.html." : "Orçamento P-08 estourado.");
  process.exit(1);
}
