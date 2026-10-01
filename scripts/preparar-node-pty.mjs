#!/usr/bin/env node
// O npm instala o `spawn-helper` do node-pty sem bit de execução em alguns ambientes e o spawn falha
// com `posix_spawnp failed`. Corrige no node_modules de desenvolvimento (o pacote tem o seu afterPack).
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const base = join(process.cwd(), "node_modules", "node-pty", "prebuilds");
if (process.platform === "win32" || !existsSync(base)) process.exit(0);
let corrigidos = 0;
for (const pasta of readdirSync(base)) {
  const helper = join(base, pasta, "spawn-helper");
  if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) {
    chmodSync(helper, 0o755);
    corrigidos += 1;
  }
}
if (corrigidos > 0) process.stdout.write(`node-pty: bit de execução restaurado em ${corrigidos} spawn-helper(s)\n`);
