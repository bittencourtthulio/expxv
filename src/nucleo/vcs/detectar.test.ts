import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectar } from "./detectar";
import { BIN_FALSO, commit, escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../tests/fixtures/vcs/repos";

let raiz: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-det-");
});
afterEach(() => removerPasta(raiz));

describe("detectar: git", () => {
  it("repositório simples: tipo git, raiz, capabilities completas; subpasta resolve a mesma raiz", async () => {
    const r = initRepo(join(raiz, "r"));
    escrever(r, "src/x/y.txt", "x");
    const d = await detectar(join(r, "src", "x"));
    expect(d.tipo).toBe("git");
    expect(d.raiz).toBe(r);
    expect(d.capabilities.stage).toBe(true);
    expect(d.capabilities.worktree).toBe(true);
    expect(d.gitDir).toBe(join(r, ".git"));
    expect(d.worktreeVinculado).toBe(false);
    expect(d.aninhadoEm).toBeNull();
  });

  it("pasta sem VCS vira nenhum, sem capabilities", async () => {
    mkdirSync(join(raiz, "vazia"));
    const d = await detectar(join(raiz, "vazia"), { limite: raiz });
    expect(d.tipo).toBe("nenhum");
    expect(d.raiz).toBeNull();
    expect(d.capabilities.stage).toBe(false);
    expect(d.capabilities.historico).toBe(false);
  });

  it("limite do workspace: não sobe para repositório fora dele", async () => {
    const r = initRepo(join(raiz, "r"));
    mkdirSync(join(r, "ws"));
    expect((await detectar(join(r, "ws"), { limite: join(r, "ws") })).tipo).toBe("nenhum");
    expect((await detectar(join(r, "ws"))).tipo).toBe("git");
  });

  it("worktrees: principal e vinculado enxergam a mesma lista; vinculado é marcado", async () => {
    const r = initRepo(join(raiz, "r"));
    const w = join(raiz, "wt");
    git(r, "worktree", "add", "-q", "-b", "feat", w);
    const dw = await detectar(w);
    expect(dw.tipo).toBe("git");
    expect(dw.worktreeVinculado).toBe(true);
    expect(dw.raiz).toBe(w);
    expect(dw.commonDir).toBe(join(r, ".git"));
    expect(dw.gitDir).toBe(join(r, ".git", "worktrees", "wt"));
    expect([...dw.worktrees].sort()).toEqual([r, w].sort());
    const dp = await detectar(r);
    expect(dp.worktreeVinculado).toBe(false);
    expect([...dp.worktrees].sort()).toEqual([r, w].sort());
  });

  it("submódulo: é marcado; o pai lista o caminho em .gitmodules", async () => {
    const sub = initRepo(join(raiz, "sub"));
    const pai = initRepo(join(raiz, "pai"));
    git(pai, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "libs/sub");
    commit(pai, "sub");
    const ds = await detectar(join(pai, "libs", "sub"));
    expect(ds.submodulo).toBe(true);
    expect(ds.raiz).toBe(join(pai, "libs", "sub"));
    expect(ds.aninhadoEm).toBe(pai);
    const dp = await detectar(pai);
    expect(dp.submodulo).toBe(false);
    expect(dp.submodulos).toEqual(["libs/sub"]);
  });

  it("repositório aninhado em outro (não submódulo) aponta o pai", async () => {
    const pai = initRepo(join(raiz, "pai"));
    const filho = initRepo(join(pai, "ferramentas", "filho"));
    const d = await detectar(filho);
    expect(d.raiz).toBe(filho);
    expect(d.aninhadoEm).toBe(pai);
    expect(d.submodulo).toBe(false);
  });

  it("git-svn: .git/svn marca git-svn (tratado como git)", async () => {
    const r = initRepo(join(raiz, "r"));
    mkdirSync(join(r, ".git", "svn"));
    const d = await detectar(r);
    expect(d.tipo).toBe("git-svn");
    expect(d.capabilities.stage).toBe(true);
  });

  it(".git corrompido (arquivo sem gitdir) não lança", async () => {
    mkdirSync(join(raiz, "x"));
    writeFileSync(join(raiz, "x", ".git"), "lixo");
    const d = await detectar(join(raiz, "x"), { limite: raiz });
    expect(d.tipo).toBe("nenhum");
    expect(d.avisos.length).toBe(1);
  });
});

describe("detectar: svn", () => {
  function copiaSvn(): string {
    const w = join(raiz, "wc");
    mkdirSync(join(w, ".svn"), { recursive: true });
    writeFileSync(join(w, ".svn", "wc.db"), "");
    mkdirSync(join(w, "sub"));
    return w;
  }

  it("com binário: lê svn info --xml (url, revisão); capabilities negam stage/stash/worktree", async () => {
    const w = copiaSvn();
    const d = await detectar(join(w, "sub"), { limite: raiz, path: `${BIN_FALSO}:/usr/bin:/bin` });
    expect(d.tipo).toBe("svn");
    expect(d.raiz).toBe(w);
    expect(d.svn).toMatchObject({ binario: true, indisponivel: false, url: "file:///repo-falso/trunk", revisao: 42, raizRepositorio: "file:///repo-falso" });
    expect(d.capabilities).toMatchObject({ stage: false, stash: false, worktree: false, remoto: false, historico: true });
  });

  it("sem o binário: 'svn indisponível' sem erro e sem executar nada", async () => {
    const w = copiaSvn();
    const d = await detectar(w, { limite: raiz, path: "/caminho/que/nao/existe" });
    expect(d.tipo).toBe("svn");
    expect(d.svn?.indisponivel).toBe(true);
    expect(d.avisos[0]).toMatch(/svn indisponível/);
    expect(d.capabilities.historico).toBe(false);
  });
});
