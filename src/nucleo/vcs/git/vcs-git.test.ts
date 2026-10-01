import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { criarVcsGit } from "./vcs-git";
import { abrirVcs } from "../index";
import { escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-vg-");
  repo = initRepo(join(raiz, "r"));
});
afterEach(() => removerPasta(raiz));

describe("Vcs git: operações ligadas à raiz", () => {
  it("fluxo completo pela interface: estagiar hunk -> commit -> ramos -> stash -> worktrees", async () => {
    const vcs = criarVcsGit(repo);
    expect(vcs.capabilities).toMatchObject({ stage: true, stash: true, worktree: true, ramos: true, commitParcial: true });
    escrever(repo, "a.txt", "UM\ndois\ntres\n");
    await vcs.git.estagio.estagiarHunk("a.txt", 0);
    expect((await vcs.status()).contagens.staged).toBe(1);
    const c = await vcs.git.commit.criar({ mensagem: "feat: pela interface", origem: "usuario" });
    expect(c.hooksPulados).toBe(false);
    await vcs.git.ramos.criar("trabalho", { trocar: true });
    expect((await vcs.git.ramos.listar()).find((r) => r.atual)?.nome).toBe("trabalho");
    escrever(repo, "x.txt", "x\n");
    expect((await vcs.git.stash.criar({ naoRastreados: true })).criado).toBe(true);
    expect((await vcs.git.stash.listar()).length).toBe(1);
    expect((await vcs.git.worktrees.listar()).length).toBe(1);
    expect(git(repo, "log", "--format=%s", "-1").trim()).toBe("feat: pela interface");
  });

  it("abrirVcs devolve o objeto com as operações", async () => {
    const v = await abrirVcs(repo);
    expect(v?.git?.estagio.ignorar).toBeTypeOf("function");
  });

  it("nenhuma operação exposta aceita push ou force", () => {
    const vcs = criarVcsGit(repo);
    const nomes = Object.values(vcs.git).flatMap((g) => Object.keys(g));
    expect(nomes.filter((n) => /push|force|forcar|reset|clean/i.test(n))).toEqual([]); // `forcar` é só parâmetro explícito, nunca método
  });
});
