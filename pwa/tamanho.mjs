// Orçamento de peso do PWA (P-164): JS <= 60 KB gz (sem framework), HTML <= 4 KB, CSS <= 12 KB gz. Falha (exit 1) ao estourar.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

export const ORCAMENTO = { js_gz: 60 * 1024, html: 4 * 1024, css_gz: 12 * 1024 };
export function medir(dist) {
  const d = resolve(dist);
  const gz = (n) => gzipSync(readFileSync(join(d, n)), { level: 9 }).length;
  const js = readdirSync(d).filter((n) => n.endsWith(".js"));
  const m = { js_gz: js.reduce((s, n) => s + gz(n), 0), html: readFileSync(join(d, "index.html")).length, css_gz: gz("app.css") };
  const estouros = Object.entries(ORCAMENTO).filter(([k, lim]) => m[k] > lim).map(([k]) => k);
  return { ...m, estouros, ok: estouros.length === 0 };
}
if (process.argv[1] && process.argv[1].endsWith("tamanho.mjs")) {
  const r = medir(process.argv[2] ?? "dist-pwa");
  console.log(JSON.stringify(r));
  if (!r.ok) process.exit(1);
}
