import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { compararComBase, criarWorktree, destravarWorktree, listarWorktrees, podarWorktrees, removerWorktree, repararWorktrees, travarWorktree, worktreesOrfaos } from "./worktrees";
import { commit, escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-wt-");
  repo = initRepo(join(raiz, "r"));
});
afterEach(() => removerPasta(raiz));

describe("listar, criar, remover", () => {
  it("lista com estado sujo/limpo, branch e principal", async () => {
    const c = await criarWorktree(repo, { branch: "feat/a" });
    let l = await listarWorktrees(repo);
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ principal: true, branch: "main", sujo: false, orfao: false, locked: false });
    expect(l[1]).toMatchObject({ branch: "feat/a", sujo: false, caminho: c.caminho });
    escrever(c.caminho, "novo.txt", "x\n");
    l = await listarWorktrees(repo);
    expect(l[1]).toMatchObject({ sujo: true, arquivosAlterados: 1 });
    expect((await listarWorktrees(repo, { comEstado: false }))[1]?.sujo).toBeNull();
  });

  it("cria com branch existente em caminho explícito; recusa branch em uso e caminho ocupado", async () => {
    git(repo, "branch", "existente");
    const dest = join(raiz, "wt-existente");
    const r = await criarWorktree(repo, { branch: "existente", ramoExistente: true, caminho: dest });
    expect(r.branch).toBe("existente");
    expect(existsSync(join(dest, "a.txt"))).toBe(true);
    await expect(criarWorktree(repo, { branch: "existente", ramoExistente: true, caminho: join(raiz, "outro") })).rejects.toThrow(); // em uso
    await expect(criarWorktree(repo, { branch: "existente", ramoExistente: true, caminho: dest })).rejects.toThrow(/já existe/);
    await expect(criarWorktree(repo, { branch: "-x", ramoExistente: true, caminho: join(raiz, "z") })).rejects.toThrow();
    await expect(criarWorktree(repo, { branch: "--detach", caminho: join(raiz, "z2") })).rejects.toThrow();
  });

  it("remover recusa árvore suja, travada e principal; simular só informa; limpo remove", async () => {
    const c = await criarWorktree(repo, { branch: "feat/b" });
    escrever(c.caminho, "x.txt", "x\n");
    expect(await removerWorktree(repo, c.caminho)).toMatchObject({ removido: false, motivo: "sujo", arquivosAlterados: 1 });
    expect(existsSync(c.caminho)).toBe(true);
    expect(await removerWorktree(repo, repo)).toMatchObject({ removido: false, motivo: "principal" });
    git(c.caminho, "add", "-A");
    git(c.caminho, "commit", "-q", "-m", "x");
    await travarWorktree(repo, c.caminho, "em uso pela missão");
    expect((await listarWorktrees(repo))[1]).toMatchObject({ locked: true, motivoTravamento: "em uso pela missão" });
    expect(await removerWorktree(repo, c.caminho)).toMatchObject({ removido: false, motivo: "travado" });
    await destravarWorktree(repo, c.caminho);
    expect(await removerWorktree(repo, c.caminho, { simular: true })).toMatchObject({ removido: false, simulado: true, motivo: null });
    expect(existsSync(c.caminho)).toBe(true);
    expect(await removerWorktree(repo, c.caminho)).toMatchObject({ removido: true });
    expect(existsSync(c.caminho)).toBe(false);
  });

  it("só opera em worktrees que o git conhece (caminho arbitrário é recusado)", async () => {
    const solto = join(raiz, "solto");
    escrever(solto, "x.txt", "x");
    await expect(removerWorktree(repo, solto)).rejects.toThrow(/Não é um worktree/);
    await expect(travarWorktree(repo, solto)).rejects.toThrow(/Não é um worktree/);
    expect(existsSync(join(solto, "x.txt"))).toBe(true);
  });
});

describe("órfão, prune, repair", () => {
  it("pasta apagada vira órfão detectado; prune (com simulação) esquece", async () => {
    const c = await criarWorktree(repo, { branch: "feat/orf" });
    renameSync(c.caminho, join(raiz, "movido"));
    const o = await worktreesOrfaos(repo);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ orfao: true, existe: false, branch: "feat/orf" });
    expect(o[0]?.motivoOrfao).toBeTruthy();
    const sim = await podarWorktrees(repo, { simular: true });
    expect(sim.podados).toHaveLength(1);
    expect((await listarWorktrees(repo)).length).toBe(2); // simulação não apagou
    const real = await podarWorktrees(repo);
    expect(real.podados).toHaveLength(1);
    expect((await listarWorktrees(repo)).length).toBe(1);
  });

  it("worktree movido à mão é reparável com repair e deixa de ser órfão", async () => {
    const c = await criarWorktree(repo, { branch: "feat/mov" });
    const novo = join(raiz, "novo-lugar");
    renameSync(c.caminho, novo);
    expect((await worktreesOrfaos(repo)).length).toBe(1);
    const r = await repararWorktrees(repo, { caminhos: [novo] });
    expect(r.reparados.length + (r.saida === "" ? 0 : 1)).toBeGreaterThan(0);
    expect(await worktreesOrfaos(repo)).toEqual([]);
    const l = await listarWorktrees(repo);
    expect(l[1]).toMatchObject({ branch: "feat/mov", orfao: false, sujo: false });
    await expect(repararWorktrees(repo, { caminhos: ["--all"] })).rejects.toThrow();
  });
});

describe("comparar com a base", () => {
  it("ahead/behind e diffStat contra a branch padrão", async () => {
    const c = await criarWorktree(repo, { branch: "feat/cmp" });
    escrever(c.caminho, "f1.txt", "1\n2\n");
    commit(c.caminho, "f1");
    escrever(c.caminho, "f2.txt", "x\n");
    commit(c.caminho, "f2");
    escrever(repo, "m.txt", "m\n");
    commit(repo, "avanço da main");
    const cmp = await compararComBase(repo, c.caminho);
    expect(cmp).toMatchObject({ base: "main", ahead: 2, behind: 1 });
    expect(cmp.diffStat).toMatchObject({ arquivos: 2, insercoes: 3, delecoes: 0 });
    expect((await compararComBase(repo, c.caminho, { base: "feat/cmp" })).ahead).toBe(0);
    await expect(compararComBase(repo, c.caminho, { base: "--all" })).rejects.toThrow();
    await expect(compararComBase(repo, c.caminho, { base: "nao-existe" })).rejects.toThrow();
  });
});
