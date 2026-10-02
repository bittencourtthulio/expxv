import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitSvnDcommit, gitSvnRebase, infoGitSvn } from "./gitsvn";
import { SvnRecusadoErro } from "./comum";
import { detectar } from "../detectar";
import { criarVcsGit } from "../git/vcs-git";
import { git, initRepo, isolarConfigGit, pastaTmp, removerPasta, scriptExecutavel } from "../../../../tests/fixtures/vcs/repos";

beforeAll(isolarConfigGit);
const pastas: string[] = [];
afterEach(() => pastas.splice(0).forEach(removerPasta));

/** `git` falso: registra o argv e responde `status --porcelain` conforme o arquivo `.sujo` do cwd. */
function gitFalso(): { exe: string; log: string; raiz: string } {
  const base = pastaTmp("gitsvn-");
  pastas.push(base);
  const raiz = join(base, "r");
  mkdirSync(raiz);
  const log = join(base, "argv.log");
  writeFileSync(log, "");
  const exe = scriptExecutavel(join(base, "bin", "git-falso"), `echo "$*" >> '${log}'\ncase "$*" in\n  *status*) [ -f .sujo ] && echo " M x.txt" ;;\n  *"config --get svn-remote.svn.url"*) echo "https://svn.exemplo.com/repo/trunk" ;;\n  *"svn dcommit --dry-run"*) echo "diff-tree abc def" ;;\nesac\nexit 0`);
  return { exe, log, raiz };
}
const linhas = (log: string): string[] => readFileSync(log, "utf8").split("\n").filter(Boolean);

describe("git-svn: detecção como git", () => {
  it("`.git/svn` vira git-svn, com capabilities de git, e criarVcsGit o trata como git", async () => {
    const r = initRepo(join(pastaTmp("gitsvn-d-"), "r"));
    pastas.push(join(r, ".."));
    mkdirSync(join(r, ".git", "svn"));
    const d = await detectar(r);
    expect(d.tipo).toBe("git-svn");
    expect(d.capabilities).toMatchObject({ stage: true, stash: true, worktree: true });
    const v = criarVcsGit(r, { tipo: d.tipo as "git" | "git-svn" });
    expect(v.tipo).toBe("git-svn");
    expect((await v.status()).branch).toBe("main");
    expect(git(r, "log", "--oneline")).toContain("inicial");
  });
  it("lê a URL do remoto svn", async () => {
    const f = gitFalso();
    expect(await infoGitSvn(f.raiz, { executavel: f.exe })).toMatchObject({ url: "https://svn.exemplo.com/repo/trunk" });
  });
});

describe("git-svn: rebase/dcommit só com confirmação explícita", () => {
  it("dcommit sem confirmadoServidor ou de automação NUNCA chega ao git svn", async () => {
    const f = gitFalso();
    await expect(gitSvnDcommit(f.raiz, { executavel: f.exe, origem: "usuario" })).rejects.toMatchObject({ motivo: "confirmacao-servidor" });
    await expect(gitSvnDcommit(f.raiz, { executavel: f.exe, origem: "automacao", confirmadoServidor: true })).rejects.toMatchObject({ motivo: "origem-invalida" });
    await expect(gitSvnRebase(f.raiz, { executavel: f.exe, origem: "usuario" })).rejects.toBeInstanceOf(SvnRecusadoErro);
    expect(linhas(f.log).filter((l) => l.includes("svn rebase") || l.includes("svn dcommit"))).toEqual([]);
  });
  it("simular roda só `--dry-run`; confirmado roda, mas recusa árvore suja", async () => {
    const f = gitFalso();
    const sim = await gitSvnDcommit(f.raiz, { executavel: f.exe, origem: "usuario", simular: true });
    expect(sim).toEqual({ simulado: true, saida: "diff-tree abc def\n" });
    expect(linhas(f.log).at(-1)).toContain("svn dcommit --dry-run");
    writeFileSync(join(f.raiz, ".sujo"), "");
    await expect(gitSvnDcommit(f.raiz, { executavel: f.exe, origem: "usuario", confirmadoServidor: true })).rejects.toMatchObject({ motivo: "arvore-suja" });
    expect(linhas(f.log).filter((l) => /svn dcommit$/.test(l))).toEqual([]);
    writeFileSync(join(f.raiz, ".sujo"), "");
    await import("node:fs/promises").then((m) => m.rm(join(f.raiz, ".sujo")));
    const ok = await gitSvnDcommit(f.raiz, { executavel: f.exe, origem: "usuario", confirmadoServidor: true });
    expect(ok.simulado).toBe(false);
    expect(linhas(f.log).some((l) => /svn dcommit$/.test(l))).toBe(true);
    await gitSvnRebase(f.raiz, { executavel: f.exe, origem: "usuario", confirmadoServidor: true });
    expect(linhas(f.log).some((l) => /svn rebase$/.test(l))).toBe(true);
  });
});
