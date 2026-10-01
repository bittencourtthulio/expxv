#!/usr/bin/env node
// `npm run dist:dir`: gera o app desempacotado local em dist-app/ (arquitetura da máquina, sem assinatura).
import { spawnSync } from "node:child_process";

const arq = process.arch === "arm64" ? "--arm64" : "--x64";
const r = spawnSync(
  "npx",
  ["electron-builder", "--dir", arq, "--publish", "never", "--config", "electron-builder.yml"],
  { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } },
);
process.exit(r.status ?? 1);
