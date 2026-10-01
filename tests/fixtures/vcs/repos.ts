// Utilitários de teste do versionamento: repositórios git TEMPORÁRIOS (os.tmpdir), sem rede,
// com user.name/email locais e configuração global/sistema desligadas.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const BIN_FALSO = resolve(__dirname, "bin");

const ENV_TESTE = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("GIT_")) env[k] = v;
  return { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
};

/** Config hermética também para o executor (que mantém GIT_CONFIG_GLOBAL/NOSYSTEM do ambiente). */
export function isolarConfigGit(): void {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: ENV_TESTE(), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

export function pastaTmp(prefixo = "vcs-"): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefixo)));
}

export function removerPasta(p: string): void {
  rmSync(p, { recursive: true, force: true });
}

export function escrever(raiz: string, rel: string, conteudo: string | Buffer): void {
  const abs = join(raiz, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, conteudo);
}

export function initRepo(dir: string, comCommit = true): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Teste");
  git(dir, "config", "user.email", "teste@example.invalid");
  git(dir, "config", "commit.gpgsign", "false");
  if (comCommit) {
    escrever(dir, "a.txt", "um\ndois\ntres\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "inicial");
  }
  return dir;
}

export function commit(dir: string, msg: string): void {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", msg);
}

export function scriptExecutavel(caminho: string, corpo: string): string {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, `#!/bin/sh\n${corpo}\n`);
  chmodSync(caminho, 0o755);
  return caminho;
}

/** pid vivo? */
export function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
