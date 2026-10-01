import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { gerarRepo } from "../../../tests/fixtures/vcs/gerar";
import { git, isolarConfigGit, pastaTmp, removerPasta } from "../../../tests/fixtures/vcs/repos";
import { statusGit } from "./git/status";
import { abrirVcs } from "./index";

const pastas: string[] = [];
beforeAll(isolarConfigGit);
afterEach(() => {
  for (const p of pastas.splice(0)) removerPasta(p);
});

describe("gerador de repositórios sintéticos", () => {
  it("N arquivos, M commits, ramos, renomes e conflito controlado; árvore limpa e índice consistente", async () => {
    const dir = join(pastaTmp("vcs-ger-"), "r");
    pastas.push(join(dir, ".."));
    const r = await gerarRepo(dir, { arquivos: 500, commits: 20, ramos: 3, renomes: 10, conflito: true });
    expect(r.arquivos).toHaveLength(500);
    expect(git(dir, "ls-files").trim().split("\n")).toHaveLength(500 + 1); // + conflito.txt
    expect(Number(git(dir, "rev-list", "--count", "main").trim())).toBe(r.commits);
    expect(git(dir, "branch", "--list", "feature-*").trim().split("\n")).toHaveLength(3);
    expect(existsSync(join(dir, "renomeados", "arq0.txt"))).toBe(true);
    expect((await statusGit(dir)).arquivos).toEqual([]);
    // conflito controlado: merge de um lado no outro gera UU
    git(dir, "checkout", "-q", "conflito-a");
    expect(() => git(dir, "merge", "conflito-b")).toThrow();
    expect((await statusGit(dir)).arquivos.map((a) => [a.caminho, a.conflito])).toEqual([["conflito.txt", "ambos-modificaram"]]);
  });

  it("o `Vcs` aberto pela detecção expõe status e diff", async () => {
    const dir = join(pastaTmp("vcs-ger2-"), "r");
    pastas.push(join(dir, ".."));
    await gerarRepo(dir, { arquivos: 20, commits: 2 });
    const vcs = await abrirVcs(dir);
    expect(vcs?.tipo).toBe("git");
    expect(vcs?.capabilities.stage).toBe(true);
    expect((await vcs!.status()).arquivos).toEqual([]);
    expect((await vcs!.diff()).arquivos).toEqual([]);
    const vazio = pastaTmp("vcs-nada-");
    pastas.push(vazio);
    expect(await abrirVcs(vazio, vazio)).toBeNull();
  });
});
