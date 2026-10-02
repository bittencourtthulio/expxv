import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { configSegura, ExecutorVcs } from "./executor";
import { statusGit } from "./git/status";
import { diffGit } from "./git/diff";
import { criarVcsGit } from "./git/vcs-git";
import { escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta, scriptExecutavel } from "../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
let marcador: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-conf-");
  repo = initRepo(join(raiz, "r"));
  marcador = join(raiz, "EXECUTOU");
  const hook = scriptExecutavel(join(raiz, "fsm.sh"), `touch '${marcador}'\nprintf '\\0'`);
  git(repo, "config", "core.fsmonitor", hook); // repositório "malicioso": config que executa um programa
});
afterEach(() => removerPasta(raiz));

describe("core.fsmonitor malicioso no .git/config", () => {
  it("controle positivo: sem a proteção o git executa o programa (o teste é capaz de detectar)", () => {
    execFileSync("git", ["status", "--porcelain"], { cwd: repo, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    expect(existsSync(marcador)).toBe(true);
    rmSync(marcador);
  });

  it("status e diff automáticos (executor padrão e nao_confiavel) NÃO executam nada e continuam corretos", async () => {
    escrever(repo, "a.txt", "UM\ndois\ntres\n");
    escrever(repo, "novo.txt", "n\n");
    for (const ex of [new ExecutorVcs(), new ExecutorVcs().comConfianca("nao_confiavel")]) {
      const s = await statusGit(repo, { executor: ex });
      expect(s.arquivos.map((m) => m.caminho).sort()).toEqual(["a.txt", "novo.txt"]);
      expect(s.contagens).toMatchObject({ naoStaged: 1, naoRastreados: 1 });
      const d = await diffGit(repo, { executor: ex });
      expect(d.arquivos[0]).toMatchObject({ caminho: "a.txt", insercoes: 1, delecoes: 1 });
    }
    const vcs = criarVcsGit(repo); // padrão: nao_confiavel
    expect((await vcs.status()).arquivos).toHaveLength(2);
    expect((await vcs.git.ramos.listar()).length).toBe(1);
    expect(existsSync(marcador)).toBe(false);
  });
});

describe("diff.<driver>.textconv e diff externo do .git/config (A-03)", () => {
  it("o diff nunca executa textconv/diff externo do repositório, mesmo em pasta confiável", async () => {
    const txc = scriptExecutavel(join(raiz, "txc.sh"), `touch '${marcador}'\ncat "$1"`);
    git(repo, "config", "--unset", "core.fsmonitor");
    git(repo, "config", "diff.evil.textconv", txc);
    git(repo, "config", "diff.external", txc);
    escrever(repo, ".gitattributes", "*.txt diff=evil\n");
    escrever(repo, "a.txt", "UM\ndois\ntres\n");
    for (const ex of [new ExecutorVcs(), new ExecutorVcs().comConfianca("confiavel")]) {
      const d = await diffGit(repo, { executor: ex });
      expect(d.arquivos[0]).toMatchObject({ caminho: "a.txt" });
      const staged = await diffGit(repo, { executor: ex, staged: true });
      expect(staged.arquivos).toHaveLength(0);
    }
    expect(existsSync(marcador)).toBe(false);
  });
});

describe("confiança da pasta", () => {
  it("configSegura: fsmonitor sempre desligado; hooks/ext/file só em pasta não confiável", () => {
    expect(configSegura("leitura", "confiavel")).toContain("core.fsmonitor=false");
    expect(configSegura("leitura", "confiavel").join(" ")).not.toContain("hooksPath");
    const nc = configSegura("escrita", "nao_confiavel").join(" ");
    expect(nc).toContain("core.fsmonitor=false");
    expect(nc).toContain("core.hooksPath=/dev/null");
    expect(nc).toContain("protocol.ext.allow=never");
    expect(nc).toContain("protocol.file.allow=user");
  });

  it("hook do repositório só roda quando a pasta é confiável (criarVcsGit)", async () => {
    scriptExecutavel(join(repo, ".git/hooks/pre-commit"), `touch '${marcador}'`);
    git(repo, "config", "--unset", "core.fsmonitor");
    escrever(repo, "x.txt", "x\n");
    git(repo, "add", "-A");
    await criarVcsGit(repo).git.commit.criar({ mensagem: "a", origem: "usuario" });
    expect(existsSync(marcador)).toBe(false);
    escrever(repo, "y.txt", "y\n");
    git(repo, "add", "-A");
    await criarVcsGit(repo, { confianca: "confiavel" }).git.commit.criar({ mensagem: "b", origem: "usuario" });
    expect(existsSync(marcador)).toBe(true);
  });
});
