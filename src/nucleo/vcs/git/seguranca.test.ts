import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { rodarGit, validarNomeRef, resolverRev, caminhoSeguro } from "./comum";
import { apagarRamo, apagarTag, criarRamo, criarTag, definirUpstream, renomearRamo, trocarRamo } from "./ramos";
import { aplicarStash, criarStash } from "./stash";
import { criarCommit } from "./commit";
import { descartar, estagiarArquivos, ignorar } from "./estagiar";
import { compararComBase, criarWorktree, travarWorktree } from "./worktrees";
import { escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-sg-");
  repo = initRepo(join(raiz, "r"));
});
afterEach(() => removerPasta(raiz));

const MALICIOSOS = ["-x", "--upload-pack=touch /tmp/pwn", "--force", "-D", "a b", "a\nb", "a'b", 'a"b', "--", "a..b", "$(id)", "`id`", "a;b"];

describe("injeção de opção/comando", () => {
  it("rodarGit recusa push e qualquer flag de força, sem executar", () => {
    for (const args of [["push"], ["push", "origin", "main"], ["branch", "-f", "x"], ["checkout", "--force", "x"], ["commit", "--force-with-lease"], ["x\0y"]]) {
      expect(() => rodarGit(repo, args)).toThrow();
    }
  });

  it("nomes maliciosos nunca chegam ao git como opção (ramos, tags, base, upstream)", async () => {
    for (const n of MALICIOSOS) {
      await expect(validarNomeRef(repo, n)).rejects.toThrow();
      await expect(criarRamo(repo, n)).rejects.toThrow();
      await expect(criarTag(repo, n)).rejects.toThrow();
      await expect(apagarRamo(repo, n)).rejects.toThrow();
      await expect(apagarTag(repo, n)).rejects.toThrow();
      await expect(renomearRamo(repo, "main", n)).rejects.toThrow();
      await expect(definirUpstream(repo, "main", n)).rejects.toThrow();
      await expect(trocarRamo(repo, n)).rejects.toThrow();
      await expect(compararComBase(repo, repo, { base: n })).rejects.toThrow();
      if (!n.includes("..") || n.startsWith("-") || /\s/.test(n)) await expect(resolverRev(repo, n)).rejects.toThrow();
    }
    expect(existsSync("/tmp/pwn")).toBe(false);
    expect(git(repo, "branch", "--list").trim()).toBe("* main");
    expect(git(repo, "tag", "--list").trim()).toBe("");
  });

  it("caminhos maliciosos: '..', absoluto, NUL; começar com '-' é seguro (sempre depois de --)", async () => {
    for (const c of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a\0b", ""]) expect(() => caminhoSeguro(c)).toThrow();
    escrever(repo, "-n.txt", "x\n");
    await estagiarArquivos(repo, ["-n.txt"]);
    expect(git(repo, "ls-files").split("\n")).toContain("-n.txt");
    await expect(estagiarArquivos(repo, ["../fora"])).rejects.toThrow();
  });

  it("mensagem de commit, de stash e de tag que parecem opção ou shell viram só texto", async () => {
    git(repo, "switch", "-q", "-c", "t");
    escrever(repo, "x.txt", "x\n");
    git(repo, "add", "-A");
    const msg = "--amend --no-verify -F /etc/passwd; $(touch /tmp/pwn2) `id`\n--force";
    await criarCommit(repo, { mensagem: msg, origem: "usuario" });
    expect(git(repo, "log", "-1", "--format=%B").trim()).toBe(msg);
    expect(git(repo, "rev-list", "--count", "HEAD").trim()).toBe("2");
    escrever(repo, "y.txt", "y\n");
    const s = await criarStash(repo, { mensagem: "--all; $(touch /tmp/pwn2)", naoRastreados: true });
    expect(s.criado).toBe(true);
    expect(git(repo, "stash", "list")).toContain("--all; $(touch /tmp/pwn2)");
    await criarTag(repo, "v1", { mensagem: "-d v1\n--force" });
    expect(git(repo, "tag", "-l", "-n9", "v1")).toContain("-d v1");
    expect(existsSync("/tmp/pwn2")).toBe(false);
  });

  it("stash: índice não inteiro/negativo recusado; worktree: motivo de trava e caminho não opção", async () => {
    await expect(aplicarStash(repo, -1)).rejects.toThrow();
    const c = await criarWorktree(repo, { branch: "feat/s" });
    await travarWorktree(repo, c.caminho, "--force; rm -rf /");
    expect(git(repo, "worktree", "list", "--porcelain")).toContain("locked --force; rm -rf /");
  });

  it("ignorar não aceita padrão com quebra de linha (não injeta regra extra)", async () => {
    await expect(ignorar(repo, ["ok\n!importante"])).rejects.toThrow();
    expect(existsSync(join(repo, ".gitignore"))).toBe(false);
  });

  it("descartar jamais apaga: sem lixeira funcional o arquivo continua lá", async () => {
    escrever(repo, "nr.txt", "nr\n");
    await descartar(repo, ["nr.txt"], { pastaSeguranca: join(raiz, "s"), moverParaLixeira: async () => undefined });
    expect(existsSync(join(repo, "nr.txt"))).toBe(true);
    await expect(descartar(repo, ["nr.txt"], { pastaSeguranca: join(raiz, "s"), moverParaLixeira: undefined as never })).rejects.toThrow(/lixeira/);
    expect(readdirSync(repo)).toContain("nr.txt");
  });
});
