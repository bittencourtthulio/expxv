// T-21.24. Uso: node scripts/auditar-dependencias.mjs [--saida sbom.json] [--registrar-base] [--audit] [--raiz <dir>]
// `npm audit` só roda com --audit (usa rede); sem resposta real fica "não executado", nunca "ok". Não versione o SBOM.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARQUIVO_BASE, auditar, falhas, gerarBase } from "./lib/auditar-dependencias.mjs";

function arg(args, nome) {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

export function principal(args = process.argv.slice(2)) {
  const raiz = resolve(arg(args, "--raiz") ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  if (args.includes("--registrar-base")) {
    const base = gerarBase(JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")));
    writeFileSync(join(raiz, ARQUIVO_BASE), `${JSON.stringify(base, null, 2)}\n`);
    console.log(`base registrada: ${base.dependencias.length} dependências em ${ARQUIVO_BASE}`);
    return 0;
  }
  const executorAudit = args.includes("--audit")
    ? () => {
        const r = spawnSync("npm", ["audit", "--omit=dev", "--json"], { cwd: raiz, encoding: "utf8", timeout: 60_000 });
        return r.error ? { erro: r.error.message } : { saida: r.stdout };
      }
    : null;
  const r = auditar(raiz, { executorAudit });
  const saida = arg(args, "--saida");
  if (saida) {
    mkdirSync(dirname(resolve(saida)), { recursive: true });
    writeFileSync(resolve(saida), `${JSON.stringify(r.sbom, null, 2)}\n`);
  }
  const f = falhas(r);
  console.log(`pacotes no lock: ${r.pacotes}`);
  console.log(`npm audit (informativo): ${r.audit.estado}${r.audit.motivo ? ` (${r.audit.motivo})` : ""}${r.audit.total ? ` total=${r.audit.total}` : ""}`);
  if (saida) console.log(`SBOM CycloneDX 1.5: ${saida}`);
  for (const x of f) console.error(`FALHA ${x}`);
  return f.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = principal();
