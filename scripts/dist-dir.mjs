#!/usr/bin/env node
// `npm run dist:dir [-- --perfil=local|ci|release|com-atualizacao|perf]`: gera o app desempacotado local em dist-app/
// (arquitetura da máquina, sem assinatura). O perfil `local` (padrão) usa o electron-builder.yml SEM derivação (diff zero, T-21.03).
import { spawnSync } from "node:child_process";
import { carregarBase, configParaPerfil, gravarConfigDerivada } from "./lib/config-builder.mjs";
import { lerDistribuicao, PERFIS } from "./lib/distribuicao.mjs";

const arg = process.argv.slice(2).find((a) => a.startsWith("--perfil="));
const perfil = arg === undefined ? "local" : arg.slice("--perfil=".length);
if (!PERFIS.includes(perfil)) {
  console.error(`perfil desconhecido: ${perfil.slice(0, 30)} (use ${PERFIS.join("|")})`);
  process.exit(2);
}
let config = "electron-builder.yml";
try {
  const distribuicao = lerDistribuicao(undefined, { perfil }); // falha o build se build/distribuicao.json for inválido
  if (perfil !== "local") {
    const { config: derivada, avisos } = configParaPerfil(carregarBase(), perfil, { distribuicao });
    for (const a of avisos) console.warn(`aviso: ${a}`);
    config = gravarConfigDerivada(derivada, perfil);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : "falha ao preparar o perfil");
  process.exit(1);
}

const arq = process.arch === "arm64" ? "--arm64" : "--x64";
const r = spawnSync("npx", ["electron-builder", "--dir", arq, "--publish", "never", "--config", config], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
});
process.exit(r.status ?? 1);
