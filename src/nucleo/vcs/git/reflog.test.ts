import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { desfazerUltimaOperacao, listarReflog, tipoDoAssunto } from "./reflog";
import { mesclar, rebase } from "./merge";
import { pullRemoto } from "./remotos";
import { commit, escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-rl-");
  repo = initRepo(join(raiz, "r"));
});
afterEach(() => removerPasta(raiz));

const head = (): string => git(repo, "rev-parse", "HEAD").trim();

describe("reflog", () => {
  it("lista HEAD e ramos com tipo e data; classifica assuntos", async () => {
    git(repo, "switch", "-q", "-c", "x");
    escrever(repo, "n.txt", "1\n");
    commit(repo, "n");
    const h = await listarReflog(repo);
    expect(h.map((e) => e.tipo).slice(0, 3)).toEqual(["commit", "checkout", "commit-inicial"]);
    expect(h[0]).toMatchObject({ indice: 0, seletor: "HEAD@{0}" });
    expect(h[0]?.data).toMatch(/^\d{4}-/);
    expect((await listarReflog(repo, { ramo: "x" })).length).toBeGreaterThan(0);
    await expect(listarReflog(repo, { ramo: "--all" })).rejects.toThrow();
    expect(["commit (merge): m", "merge x: Fast-forward", "pull: Fast-forward", "rebase (finish): r", "cherry-pick: c", "revert: r", "reset: moving to x", "stash"].map(tipoDoAssunto)).toEqual(["merge", "merge", "pull", "rebase", "cherry-pick", "revert", "reset", "outro"]);
  });
});

describe("desfazer a última operação", () => {
  it("commit: volta ao ponto exato e mantém mudanças comitadas (no índice) e não comitadas", async () => {
    escrever(repo, "a.txt", "um\ndois\ntres\nQUATRO\n");
    commit(repo, "usa a.txt");
    const antes = git(repo, "rev-parse", "HEAD~1").trim();
    escrever(repo, "solto.txt", "nao comitado\n");
    const sim = await desfazerUltimaOperacao(repo, { simular: true });
    expect(sim).toMatchObject({ seguro: true, modo: "soft", desfeito: false, para: antes });
    expect(head()).not.toBe(antes);
    const r = await desfazerUltimaOperacao(repo);
    expect(r).toMatchObject({ seguro: true, desfeito: true });
    expect(head()).toBe(antes);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("um\ndois\ntres\nQUATRO\n");
    expect(readFileSync(join(repo, "solto.txt"), "utf8")).toBe("nao comitado\n");
    expect(git(repo, "status", "--porcelain")).toContain("M  a.txt"); // a mudança do commit ficou no índice
  });

  it("merge com commit: HEAD volta, árvore volta, mudança não comitada não relacionada sobrevive", async () => {
    git(repo, "switch", "-q", "-c", "lado");
    escrever(repo, "l.txt", "l\n");
    commit(repo, "lado");
    git(repo, "switch", "-q", "main");
    escrever(repo, "p.txt", "p\n");
    commit(repo, "principal");
    git(repo, "switch", "-q", "-c", "trabalho");
    const antes = head();
    await mesclar(repo, { rev: "lado", origem: "usuario", semFastForward: true });
    expect(git(repo, "log", "-1", "--format=%P").trim().split(" ")).toHaveLength(2);
    escrever(repo, "a.txt", "um\nDOIS\ntres\n"); // mudança não comitada
    const r = await desfazerUltimaOperacao(repo);
    expect(r).toMatchObject({ seguro: true, modo: "keep", desfeito: true, operacao: "merge" });
    expect(head()).toBe(antes);
    expect(() => readFileSync(join(repo, "l.txt"))).toThrow();
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("um\nDOIS\ntres\n");
  });

  it("merge fast-forward e rebase concluído voltam ao ponto exato", async () => {
    git(repo, "switch", "-q", "-c", "ff");
    escrever(repo, "f.txt", "f\n");
    commit(repo, "f");
    git(repo, "switch", "-q", "-c", "alvo", "main");
    const antesFf = head();
    expect((await mesclar(repo, { rev: "ff", origem: "usuario" })).resultado).toBe("ok");
    expect(await desfazerUltimaOperacao(repo)).toMatchObject({ seguro: true, desfeito: true });
    expect(head()).toBe(antesFf);

    git(repo, "switch", "-q", "main");
    escrever(repo, "m.txt", "m\n");
    commit(repo, "main avanca");
    git(repo, "switch", "-q", "ff");
    const antesRb = head();
    await rebase(repo, { base: "main", origem: "usuario" });
    expect(head()).not.toBe(antesRb);
    const r = await desfazerUltimaOperacao(repo);
    expect(r).toMatchObject({ seguro: true, operacao: "rebase", desfeito: true });
    expect(head()).toBe(antesRb);
    expect(git(repo, "symbolic-ref", "--short", "HEAD").trim()).toBe("ff");
  });

  it("pull que avançou o branch é desfeito (mesmo com o resultado já estando na remota)", async () => {
    const bare = join(raiz, "remoto.git");
    git(raiz, "init", "-q", "--bare", "-b", "main", bare);
    git(repo, "remote", "add", "origin", `file://${bare}`);
    git(repo, "push", "-q", "-u", "origin", "main");
    const outro = join(raiz, "outro");
    git(raiz, "clone", "-q", `file://${bare}`, outro);
    git(outro, "config", "user.name", "O");
    git(outro, "config", "user.email", "o@example.invalid");
    escrever(outro, "o.txt", "o\n");
    commit(outro, "do outro");
    git(outro, "push", "-q", "origin", "main");
    git(repo, "switch", "-q", "-c", "trabalho");
    git(repo, "branch", "-q", "-u", "origin/main");
    git(repo, "fetch", "-q");
    const antes = head();
    const p = await pullRemoto(repo, { origem: "usuario" });
    expect(p.resultado).toBe("ok");
    const r = await desfazerUltimaOperacao(repo);
    expect(r).toMatchObject({ seguro: true, operacao: "pull", desfeito: true });
    expect(head()).toBe(antes);
  });

  it("recusa (seguro: false) com motivo: checkout, publicado, operação em curso, mudança que seria perdida; nada muda", async () => {
    git(repo, "switch", "-q", "-c", "x");
    expect(await desfazerUltimaOperacao(repo)).toMatchObject({ seguro: false, motivo: expect.stringContaining("checkout") });

    escrever(repo, "a.txt", "um\ndois\ntres\nmais\n");
    commit(repo, "mais");
    const bare = join(raiz, "remoto.git");
    git(raiz, "init", "-q", "--bare", "-b", "main", bare);
    git(repo, "remote", "add", "origin", `file://${bare}`);
    git(repo, "push", "-q", "-u", "origin", "x");
    expect(await desfazerUltimaOperacao(repo)).toMatchObject({ seguro: false, motivo: expect.stringContaining("publicado") });

    escrever(repo, "a.txt", "um\ndois\ntres\nmais\nlocal\n");
    commit(repo, "local");
    git(repo, "branch", "-q", "lado", "HEAD~1");
    // merge --no-ff que toca a.txt e, depois, edição não comitada em a.txt: reset --keep recusaria
    git(repo, "switch", "-q", "-c", "m2", "HEAD~1");
    escrever(repo, "b.txt", "b\n");
    commit(repo, "b");
    await mesclar(repo, { rev: "x", origem: "usuario", semFastForward: true });
    escrever(repo, "a.txt", "um\ndois\ntres\nmais\nlocal\nEDITADO\n");
    const antes = head();
    const r = await desfazerUltimaOperacao(repo);
    expect(r).toMatchObject({ seguro: false, motivo: expect.stringContaining("não comitadas") });
    expect(head()).toBe(antes);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toContain("EDITADO");

    git(repo, "checkout", "-q", "--", "a.txt");
    git(repo, "switch", "-q", "-c", "conf", "main");
    escrever(repo, "c.txt", "a\nb\n");
    commit(repo, "c");
    git(repo, "switch", "-q", "-c", "conf2", "HEAD~1");
    escrever(repo, "c.txt", "a\nZ\n");
    commit(repo, "c2");
    await mesclar(repo, { rev: "conf", origem: "usuario" });
    expect(await desfazerUltimaOperacao(repo)).toMatchObject({ seguro: false, motivo: expect.stringContaining("em andamento") });
    expect(await desfazerUltimaOperacao(repo, { origem: "automacao" }).catch((e: Error) => e.name)).toBeDefined();
  });

  it("automação na branch padrão não desfaz", async () => {
    escrever(repo, "z.txt", "z\n");
    commit(repo, "z");
    await expect(desfazerUltimaOperacao(repo, { origem: "automacao" })).rejects.toMatchObject({ motivo: "automacao-ramo-padrao" });
  });
});
