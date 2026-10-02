// T-06.40 (achado A-01): a porta do git é uma ALLOWLIST de subcomandos, não uma denylist de `push`. Opções globais antes do
// subcomando (`-C`, `-c alias.x=!cmd`, `--exec-path`) e subcomandos de rede/execução nunca passam por `rodarGit`.
import { describe, expect, it } from "vitest";
import type { ExecutorVcs } from "../executor";
import { rodarGit } from "./comum";
import { rodarRemoto } from "./remotos";

const gravador = (): { ex: ExecutorVcs; chamadas: string[][] } => {
  const chamadas: string[][] = [];
  const ex = { executar: async (args: readonly string[]) => (chamadas.push([...args]), { codigo: 0, stdout: "", stderr: "", truncado: false, encerradoPorLimite: false, duracaoMs: 0 }) } as unknown as ExecutorVcs;
  return { ex, chamadas };
};

describe("rodarGit: allowlist de subcomandos", () => {
  it("recusa push disfarçado por opção global, rede, clone e execução arbitrária (sem executar nada)", () => {
    const { ex, chamadas } = gravador();
    for (const args of [
      ["-C", "/tmp", "push"], ["-c", "alias.x=!sh", "status"], ["--exec-path=/tmp", "status"], ["--git-dir=/tmp/x", "status"],
      ["push"], ["fetch"], ["pull"], ["clone", "https://x/y"], ["gc"], ["filter-branch"], ["daemon"], ["credential", "fill"], ["remote", "add", "x", "y"], ["send-email"], ["x"], [""],
    ]) {
      expect(() => rodarGit("/tmp", args, { executor: ex })).toThrow(/proibida/);
    }
    expect(chamadas).toEqual([]);
  });
  it("aceita os subcomandos de trabalho", async () => {
    const { ex, chamadas } = gravador();
    for (const sub of ["status", "log", "diff", "commit", "merge", "rebase", "stash", "branch", "worktree", "cherry-pick", "revert", "reset", "restore", "switch", "svn"]) await rodarGit("/tmp", [sub], { executor: ex });
    expect(chamadas).toHaveLength(15);
  });
});

describe("rodarRemoto: só fetch/pull/push/submodule, sem flags de força nem execução", () => {
  const ok = async (args: string[]): Promise<void> => {
    const { ex } = gravador();
    await rodarRemoto("/tmp", args, { executor: ex });
  };
  const recusa = async (args: string[]): Promise<void> => {
    const { ex, chamadas } = gravador();
    await expect(rodarRemoto("/tmp", args, { executor: ex })).rejects.toThrow(/proibida/);
    expect(chamadas).toEqual([]);
  };
  it("recusa outros subcomandos e opções globais perigosas", async () => {
    for (const a of [["clone", "x"], ["-C", "/x", "fetch"], ["-c", "core.sshCommand=sh", "fetch"], ["--exec-path=/x", "fetch"], ["status"], ["remote", "add", "x", "y"], ["ls-remote", "origin"]]) await recusa(a);
  });
  it("recusa força (exceto lease com ref esperada), espelho, apagar ref remota e programas externos", async () => {
    for (const a of [
      ["push", "--force", "origin", "x"], ["push", "-f", "origin", "x"], ["push", "--force-with-lease", "origin", "x"], ["push", "--force-if-includes", "origin", "x"],
      ["push", "--mirror", "origin"], ["push", "--delete", "origin", "x"], ["push", "origin", ":x"], ["push", "origin", "+refs/heads/x:refs/heads/x"],
      ["fetch", "--upload-pack=sh", "origin"], ["push", "--receive-pack=sh", "origin"], ["fetch", "--exec=sh"], ["push", "--exec=sh"], ["pull", "--upload-pack", "sh"],
    ]) await recusa(a);
  });
  it("aceita exatamente o que o app usa", async () => {
    await ok(["fetch", "--no-recurse-submodules", "--prune", "origin"]);
    await ok(["fetch", "--no-recurse-submodules", "--all"]);
    await ok(["pull", "--ff-only", "origin", "main"]);
    await ok(["push", "--porcelain", "--set-upstream", "origin", "refs/heads/x:refs/heads/x"]);
    await ok(["push", "--porcelain", "--force-with-lease=refs/heads/x:0123456789abcdef", "origin", "refs/heads/x:refs/heads/x"]);
    await ok(["-c", "protocol.file.allow=user", "-c", "protocol.ext.allow=never", "submodule", "update", "--init", "--", "libs/a"]);
  });
});
