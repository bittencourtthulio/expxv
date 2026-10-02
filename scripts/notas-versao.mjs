// T-21.25. Uso: node scripts/notas-versao.mjs --versao 1.2.3 [--changelog CHANGELOG.md] [--saida NOTAS.md] [--saida-texto notas.txt]
// Sem --changelog (ou arquivo ausente): nota mínima do `git log` local. Sem --saida, imprime o Markdown.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gerarNotas } from "./lib/notas-versao.mjs";

const arg = (a, n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const gravar = (c, t) => { mkdirSync(dirname(resolve(c)), { recursive: true }); writeFileSync(resolve(c), t); };

export function principal(args = process.argv.slice(2)) {
  try {
    let versao = arg(args, "--versao");
    if (!versao) versao = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
    const arq = arg(args, "--changelog");
    const temArquivo = Boolean(arq) && existsSync(resolve(arq));
    const r = gerarNotas({
      versao,
      changelog: temArquivo ? readFileSync(resolve(arq), "utf8") : null,
      executorGit: (a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
    });
    const saida = arg(args, "--saida");
    if (saida) gravar(saida, r.markdown); else process.stdout.write(r.markdown);
    const txt = arg(args, "--saida-texto");
    if (txt) gravar(txt, r.texto);
    return 0;
  } catch (e) {
    console.error(`erro: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = principal();
