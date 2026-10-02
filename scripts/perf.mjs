#!/usr/bin/env node
// `npm run perf`: constrói, mede os orçamentos dinâmicos no Electron real e falha se algum estourar.
// Saída: docs/ade/perf/ultimo.json (valores, limites, veredito). Fator de tolerância: EXPXV_PERF_FATOR.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

// Todo orçamento P-01..P-15 precisa ter sido medido NESTA execução (o arquivo é apagado antes: valor velho nunca vale).
// P-08 (bundle) e P-14 (banco, Node puro) também vêm de tests/perf; as demais linhas são do Electron real.
const ESPERADOS = Array.from({ length: 15 }, (_, i) => `P-${String(i + 1).padStart(2, "0")}`);
const arquivo = "docs/ade/perf/ultimo.json";

const passos = [
  ["build", "npm", ["run", "--silent", "build"]],
  ["orçamentos (P-01..P-15)", "npx", ["vitest", "run", "--config", "vitest.e2e.config.mts", "tests/perf"]],
];
rmSync(arquivo, { force: true });
let testesFalharam = false;

for (const [nome, cmd, args] of passos) {
  process.stdout.write(`\n▶ ${nome}\n`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    process.stderr.write(`\n✖ ${nome} falhou\n`);
    // só o build interrompe: se um teste de orçamento ficou vermelho, a tabela abaixo mostra o valor real
    if (nome === "build") process.exit(r.status ?? 1);
    testesFalharam = true;
  }
}

if (!existsSync(arquivo)) {
  process.stderr.write(`\n✖ ${arquivo} não foi gerado\n`);
  process.exit(1);
}
const { medicoes } = JSON.parse(readFileSync(arquivo, "utf8"));
process.stdout.write("\nOrçamentos:\n");
let falhou = false;
const presentes = new Set(medicoes.map((m) => m.id));
const faltando = ESPERADOS.filter((id) => !presentes.has(id));
if (faltando.length > 0) {
  process.stderr.write(`\n✖ orçamentos sem medição nesta execução: ${faltando.join(", ")}\n`);
  falhou = true;
}
for (const m of medicoes) {
  const sinal = m.medido === false ? "—" : m.ok ? "✔" : "✖"; // «—» = não medido (ex.: P-168 sem Docker): nunca verde falso
  const op = m.sentido === "min" ? "≥" : "≤";
  if (m.medido === false) process.stdout.write(`  ${sinal} ${m.id.padEnd(5)} ${m.descricao.padEnd(78)} não medido: ${m.motivo ?? "?"}\n`);
  else process.stdout.write(`  ${sinal} ${m.id.padEnd(5)} ${m.descricao.padEnd(78)} ${String(m.valor).padStart(8)} ${m.unidade} (${op} ${m.limite})${m.pior === undefined ? "" : `  pior ${m.pior}`}\n`);
  if (!m.ok && m.medido !== false) falhou = true;
}
process.exit(falhou || testesFalharam ? 1 : 0);
