#!/usr/bin/env node
// `npm run renomear` (T-21.05): renomeia o produto por lista fechada. Padrão = --dry-run (não grava nada).
//   --nome <Nome> --id <id> --dono <dono> --repo <repo> --host-feed <host> --migrar-dados
//   --dry-run (padrão) | --aplicar | --reverter <renomeacao-AAAA-MM-DD.json> | --raiz <pasta>
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aplicar, planejar, resumo, reverter } from "./lib/renomear.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const valorDe = new Set(["--nome", "--id", "--dono", "--repo", "--host-feed", "--raiz", "--reverter"]);
const flags = new Set(["--dry-run", "--aplicar", "--migrar-dados"]);
const op = {};
let raiz = resolve(AQUI, "..");
let modo = "dry-run";
let relatorio = null;

function falhar(msg) {
  process.stderr.write(`renomear: ${msg}\n`);
  process.exit(1);
}

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (flags.has(a)) {
    if (a === "--aplicar") modo = "aplicar";
    else if (a === "--migrar-dados") op.migrarDados = true;
    continue;
  }
  if (!valorDe.has(a)) falhar(`opção desconhecida: ${a}`);
  const v = argv[++i];
  if (v === undefined || v.startsWith("--")) falhar(`a opção ${a} pede um valor`);
  if (a === "--nome") op.nome = v;
  else if (a === "--id") op.id = v;
  else if (a === "--dono") op.dono = v;
  else if (a === "--repo") op.repo = v;
  else if (a === "--host-feed") op.hostFeed = v;
  else if (a === "--raiz") raiz = resolve(v);
  else if (a === "--reverter") {
    modo = "reverter";
    relatorio = resolve(v);
  }
}
if (argv.includes("--aplicar") && argv.includes("--dry-run")) falhar("--aplicar e --dry-run juntos: escolha um");

try {
  if (modo === "reverter") {
    const r = reverter(raiz, relatorio);
    process.stdout.write(`Revertido: ${r.restaurados.join(", ") || "(nada)"}\n`);
  } else {
    const plano = planejar(raiz, op);
    if (modo === "dry-run") {
      process.stdout.write(`[dry-run] nada foi gravado.\n${resumo(plano)}\n`);
    } else {
      const { caminhoRelatorio } = aplicar(raiz, plano);
      process.stdout.write(`${resumo(plano)}\nAplicado. Relatório: ${caminhoRelatorio}\nReverter: npm run renomear -- --reverter ${caminhoRelatorio}\n`);
    }
  }
} catch (e) {
  falhar(e instanceof Error ? e.message : String(e));
}
