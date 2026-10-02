#!/usr/bin/env node
// `gh` falso dos testes de "Adicionar workspace": nenhuma rede. O comportamento vem de GH_FALSO_MODO:
//   ok (padrão) | nao_autenticado | rede | lixo   (também implementa `repo clone` criando a pasta de destino)
// Registra cada chamada (um JSON por linha) em GH_FALSO_LOG, se definido.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const modo = process.env.GH_FALSO_MODO ?? "ok";
if (process.env.GH_FALSO_LOG) appendFileSync(process.env.GH_FALSO_LOG, `${JSON.stringify(args)}\n`);

if (args[0] === "--version") {
  console.log("gh version 2.99.0 (2099-01-01)");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  if (modo === "nao_autenticado") {
    console.error("You are not logged into any GitHub hosts. To log in, run: gh auth login");
    process.exit(1);
  }
  console.log("github.com\n  ✓ Logged in to github.com account fulana (keyring)\n  - Active account: true\n  - Git operations protocol: https\n");
  process.exit(0);
}
if (args[0] === "repo" && args[1] === "list") {
  if (modo === "nao_autenticado") {
    console.error("To get started with GitHub CLI, please run:  gh auth login");
    process.exit(4);
  }
  if (modo === "rede") {
    console.error("error connecting to api.github.com\nCheck your internet connection or https://githubstatus.com");
    process.exit(1);
  }
  if (modo === "lixo") {
    console.log("isto nao e json");
    process.exit(0);
  }
  console.log(JSON.stringify([
    { name: "antigo", nameWithOwner: "fulana/antigo", description: "primeiro\u0007 repo", isPrivate: false, pushedAt: "2023-01-01T00:00:00Z", url: "https://github.com/fulana/antigo" },
    { name: "recente", nameWithOwner: "fulana/recente", description: "segredo", isPrivate: true, pushedAt: "2026-09-30T12:00:00Z", url: "https://github.com/fulana/recente" },
    { name: "malicioso", nameWithOwner: "fulana/malicioso", description: "x", isPrivate: false, pushedAt: "2025-01-01T00:00:00Z", url: "javascript:alert(1)" },
    { name: "-oProxy", nameWithOwner: "-oProxy/x", description: "x", isPrivate: false, pushedAt: "2025-01-01T00:00:00Z", url: "https://github.com/x/y" },
    { name: "sem-data", nameWithOwner: "fulana/sem-data", description: "", isPrivate: false, pushedAt: "", url: "https://github.com/fulana/sem-data" },
  ]));
  process.exit(0);
}
if (args[0] === "repo" && args[1] === "clone") {
  // gh repo clone <slug> <destino> -- <flags do git>: cria a pasta como o git faria (sem rede)
  mkdirSync(args[3], { recursive: true });
  writeFileSync(join(args[3], "veio-do-gh.txt"), args[2]);
  process.stderr.write("Receiving objects: 100% (3/3), 1.00 KiB | 1.00 MiB/s, done.\n");
  process.exit(0);
}
console.error(`gh falso: comando não suportado: ${args.join(" ")}`);
process.exit(2);
