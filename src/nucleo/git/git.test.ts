import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArvoreSujaErro,
  GitOperacaoProibidaErro,
  GitTimeoutErro,
  NaoEhRepoErro,
  NomeInvalidoErro,
  WorktreeInvalidoErro,
  ambienteLimpo,
  branchAtual,
  diffStat,
  ehRepo,
  executarGit,
  exigirArvoreLimpa,
  ramoExiste,
  raizDoRepo,
  statusResumo,
  worktreeAdd,
  worktreeList,
  worktreeRemove,
} from "./index";

let raizTmp: string;
let repo: string;

function gitSync(cwd: string, ...args: string[]): string {
  const env: NodeJS.ProcessEnv = { ...ambienteLimpo(), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  return execFileSync("git", args, { cwd, env, encoding: "utf8" });
}

function criarRepo(pasta: string, comCommit = true): void {
  mkdirSync(pasta, { recursive: true });
  gitSync(pasta, "init", "-q", "-b", "main");
  gitSync(pasta, "config", "user.name", "Teste");
  gitSync(pasta, "config", "user.email", "teste@example.invalid");
  gitSync(pasta, "config", "commit.gpgsign", "false");
  if (comCommit) {
    writeFileSync(join(pasta, "a.txt"), "um\n");
    gitSync(pasta, "add", "a.txt");
    gitSync(pasta, "commit", "-q", "-m", "inicial");
  }
}

beforeEach(() => {
  raizTmp = realpathSync(mkdtempSync(join(tmpdir(), "expxv-git-")));
  repo = join(raizTmp, "meu-repo");
  criarRepo(repo);
});
afterEach(() => {
  rmSync(raizTmp, { recursive: true, force: true });
});

describe("executarGit", () => {
  it("ambiente limpo não herda GIT_*", () => {
    const env = ambienteLimpo({ GIT_DIR: "/x", GIT_INDEX_FILE: "/y", PATH: "/bin", HOME: "/h" });
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_INDEX_FILE).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("GIT_DIR do ambiente do processo não desvia o repositório alvo", async () => {
    process.env.GIT_DIR = join(raizTmp, "outro");
    try {
      expect(await ehRepo(repo)).toBe(true);
    } finally {
      delete process.env.GIT_DIR;
    }
  });

  it("recusa push e flags de força sem chegar a executar", () => {
    expect(() => executarGit(["push", "origin", "main"], { cwd: repo })).toThrow(GitOperacaoProibidaErro);
    expect(() => executarGit(["worktree", "remove", "--force", "x"], { cwd: repo })).toThrow(GitOperacaoProibidaErro);
    expect(() => executarGit(["branch", "-f", "a", "b"], { cwd: repo })).toThrow(GitOperacaoProibidaErro);
  });

  it("não bloqueia o event loop (timers continuam disparando durante a chamada)", async () => {
    let ticks = 0;
    const t = setInterval(() => ticks++, 1);
    await Promise.all(Array.from({ length: 10 }, () => statusResumo(repo)));
    clearInterval(t);
    expect(ticks).toBeGreaterThan(0);
  });

  it("respeita o timeout com um executável lento simulado", async () => {
    const falso = join(raizTmp, "git-lento");
    writeFileSync(falso, "#!/bin/sh\nexec sleep 10\n");
    chmodSync(falso, 0o755);
    const t0 = Date.now();
    await expect(executarGit(["status"], { cwd: repo, executavel: falso, timeoutMs: 200 })).rejects.toBeInstanceOf(GitTimeoutErro);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("trunca saída grande no teto e sinaliza", async () => {
    const falso = join(raizTmp, "git-verboso");
    writeFileSync(falso, "#!/bin/sh\nhead -c 3000000 /dev/zero | tr '\\0' a\n");
    chmodSync(falso, 0o755);
    const r = await executarGit(["log"], { cwd: repo, executavel: falso });
    expect(r.truncado).toBe(true);
    expect(r.stdout.length).toBe(1024 * 1024);
    const pequeno = await executarGit(["log"], { cwd: repo, executavel: falso, maxBytes: 100 });
    expect(pequeno.stdout.length).toBe(100);
  });

  it("código ≠ 0 lança GitErro com stderr; executável ausente vira erro nominal", async () => {
    await expect(executarGit(["rev-parse", "naoexiste"], { cwd: repo })).rejects.toMatchObject({ name: "GitErro", codigo: 128 });
    await expect(executarGit(["status"], { cwd: repo, executavel: join(raizTmp, "nao-existe") })).rejects.toMatchObject({ name: "GitIndisponivelErro" });
    await expect(executarGit(["status"], { cwd: join(raizTmp, "sumiu") })).rejects.toThrow(/inexistente/);
  });
});

describe("status", () => {
  it("ehRepo / raizDoRepo", async () => {
    expect(await ehRepo(repo)).toBe(true);
    mkdirSync(join(repo, "sub"));
    expect(await ehRepo(join(repo, "sub"))).toBe(true);
    expect(await raizDoRepo(join(repo, "sub"))).toBe(repo);
    const fora = join(raizTmp, "fora");
    mkdirSync(fora);
    expect(await ehRepo(fora)).toBe(false);
    expect(await ehRepo(join(raizTmp, "inexistente"))).toBe(false);
    await expect(raizDoRepo(fora)).rejects.toBeInstanceOf(NaoEhRepoErro);
  });

  it("branch atual em repo recém-criado (sem commits) e com commit; destacado é null", async () => {
    const novo = join(raizTmp, "novo");
    criarRepo(novo, false);
    expect(await branchAtual(novo)).toBe("main");
    expect(await branchAtual(repo)).toBe("main");
    gitSync(repo, "checkout", "-q", "--detach");
    expect(await branchAtual(repo)).toBeNull();
  });

  it("statusResumo: limpo, depois contagens", async () => {
    expect(await statusResumo(repo)).toMatchObject({ branch: "main", limpo: true, sujo: false, staged: 0, modificados: 0, nao_rastreados: 0 });
    writeFileSync(join(repo, "a.txt"), "dois\n");
    writeFileSync(join(repo, "novo.txt"), "x\n");
    writeFileSync(join(repo, "staged.txt"), "x\n");
    gitSync(repo, "add", "staged.txt");
    expect(await statusResumo(repo)).toMatchObject({ sujo: true, limpo: false, staged: 1, modificados: 1, nao_rastreados: 1, conflitos: 0 });
  });

  it("statusResumo em repo sem commits e fora de repo", async () => {
    const novo = join(raizTmp, "novo");
    criarRepo(novo, false);
    expect(await statusResumo(novo)).toMatchObject({ branch: "main", limpo: true });
    const fora = join(raizTmp, "fora");
    mkdirSync(fora);
    await expect(statusResumo(fora)).rejects.toBeInstanceOf(NaoEhRepoErro);
  });

  it("exigirArvoreLimpa lança erro nominal no repo sujo", async () => {
    await exigirArvoreLimpa(repo);
    writeFileSync(join(repo, "sujeira.txt"), "x");
    await expect(exigirArvoreLimpa(repo)).rejects.toBeInstanceOf(ArvoreSujaErro);
  });

  it("ramoExiste e nome inválido", async () => {
    expect(await ramoExiste(repo, "main")).toBe(true);
    expect(await ramoExiste(repo, "feature/x")).toBe(false);
    await expect(ramoExiste(repo, "--evil")).rejects.toBeInstanceOf(NomeInvalidoErro);
    await expect(ramoExiste(repo, "a..b")).rejects.toBeInstanceOf(NomeInvalidoErro);
  });

  it("diffStat: árvore contra HEAD e base...HEAD", async () => {
    expect(await diffStat(repo)).toEqual({ arquivos: 0, insercoes: 0, delecoes: 0, itens: [] });
    writeFileSync(join(repo, "a.txt"), "um\ndois\ntres\n");
    const d = await diffStat(repo);
    expect(d).toMatchObject({ arquivos: 1, insercoes: 2, delecoes: 0 });
    expect(d.itens[0]?.caminho).toBe("a.txt");
    gitSync(repo, "checkout", "-q", "-b", "feat");
    gitSync(repo, "commit", "-q", "-am", "mais");
    expect(await diffStat(repo, { base: "main" })).toMatchObject({ arquivos: 1, insercoes: 2 });
    await expect(diffStat(repo, { base: "-x" })).rejects.toBeInstanceOf(NomeInvalidoErro);
  });
});

describe("worktree", () => {
  it("lista só a principal num repo novo", async () => {
    const l = await worktreeList(repo);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ principal: true, branch: "main", detached: false });
    expect(realpathSync(l[0]?.caminho as string)).toBe(repo);
  });

  it("cria com -b no nome padrão ../<repo>--<slug>, lista e remove", async () => {
    const r = await worktreeAdd({ repo, branch: "feature/Correcao_Rapida" });
    expect(r.branch).toBe("feature/Correcao_Rapida");
    expect(r.caminho).toBe(join(raizTmp, "meu-repo--feature-correcao-rapida"));
    expect(existsSync(join(r.caminho, "a.txt"))).toBe(true);
    const l = await worktreeList(repo);
    expect(l).toHaveLength(2);
    expect(l.find((w) => !w.principal)?.branch).toBe(r.branch);
    expect(await ramoExiste(repo, r.branch)).toBe(true);
    await worktreeRemove({ repo, caminho: r.caminho });
    expect(existsSync(r.caminho)).toBe(false);
    expect(await worktreeList(repo)).toHaveLength(1);
    expect(await ramoExiste(repo, r.branch)).toBe(true); // a branch não some sem pedir
  });

  it("colisão de branch/pasta acrescenta sufixo numérico", async () => {
    const a = await worktreeAdd({ repo, branch: "feature/x" });
    const b = await worktreeAdd({ repo, branch: "feature/x" });
    const c = await worktreeAdd({ repo, branch: "feature/x" });
    expect([a.tentativa, b.tentativa, c.tentativa]).toEqual([1, 2, 3]);
    expect([a.branch, b.branch, c.branch]).toEqual(["feature/x", "feature/x-2", "feature/x-3"]);
    expect(b.caminho).toBe(join(raizTmp, "meu-repo--feature-x-2"));
    expect(new Set([a.caminho, b.caminho, c.caminho]).size).toBe(3);
  });

  it("pasta ocupada (sem branch) também desloca o sufixo; caminho explícito ocupado é erro", async () => {
    mkdirSync(join(raizTmp, "meu-repo--fix-y"));
    const r = await worktreeAdd({ repo, branch: "fix/y" });
    expect(r.caminho).toBe(join(raizTmp, "meu-repo--fix-y-2"));
    expect(r.branch).toBe("fix/y-2");
    await expect(worktreeAdd({ repo, branch: "zzz", caminho: join(raizTmp, "meu-repo--fix-y") })).rejects.toBeInstanceOf(WorktreeInvalidoErro);
    const e = await worktreeAdd({ repo, branch: "zzz", caminho: "../explicito" });
    expect(e.caminho).toBe(join(raizTmp, "explicito"));
  });

  it("repo sujo: erro nominal quando exigirArvoreLimpa; sem exigir, cria", async () => {
    writeFileSync(join(repo, "sujeira.txt"), "x");
    await expect(worktreeAdd({ repo, branch: "a", exigirArvoreLimpa: true })).rejects.toBeInstanceOf(ArvoreSujaErro);
    expect(await ramoExiste(repo, "a")).toBe(false);
    expect((await worktreeAdd({ repo, branch: "a" })).branch).toBe("a");
  });

  it("remover worktree sujo dá erro nominal e nada é apagado; principal é recusada", async () => {
    const r = await worktreeAdd({ repo, branch: "b" });
    writeFileSync(join(r.caminho, "wip.txt"), "trabalho");
    await expect(worktreeRemove({ repo, caminho: r.caminho })).rejects.toBeInstanceOf(ArvoreSujaErro);
    expect(existsSync(join(r.caminho, "wip.txt"))).toBe(true);
    await expect(worktreeRemove({ repo, caminho: repo })).rejects.toBeInstanceOf(WorktreeInvalidoErro);
    await expect(worktreeRemove({ repo, caminho: join(raizTmp, "qualquer") })).rejects.toBeInstanceOf(WorktreeInvalidoErro);
  });

  it("apagarBranch usa -d: apaga se integrada, mantém se não", async () => {
    const a = await worktreeAdd({ repo, branch: "integrada" });
    expect((await worktreeRemove({ repo, caminho: a.caminho, apagarBranch: true })).branch_apagada).toBe(true);
    const b = await worktreeAdd({ repo, branch: "pendente" });
    writeFileSync(join(b.caminho, "n.txt"), "n");
    gitSync(b.caminho, "add", "n.txt");
    gitSync(b.caminho, "commit", "-q", "-m", "n");
    expect((await worktreeRemove({ repo, caminho: b.caminho, apagarBranch: true })).branch_apagada).toBe(false);
    expect(await ramoExiste(repo, "pendente")).toBe(true);
  });

  it("nome de branch inválido é erro nominal", async () => {
    await expect(worktreeAdd({ repo, branch: "a b" })).rejects.toBeInstanceOf(NomeInvalidoErro);
    await expect(worktreeAdd({ repo, branch: "-x" })).rejects.toBeInstanceOf(NomeInvalidoErro);
  });
});
