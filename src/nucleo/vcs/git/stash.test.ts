import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { aplicarStash, apagarStash, criarStash, diffStash, listarStashes, popStash, restaurarStashApagado } from "./stash";
import { commit, escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-st-");
  repo = initRepo(join(raiz, "r"));
});
afterEach(() => removerPasta(raiz));

describe("criar e listar", () => {
  it("cria com mensagem, com e sem não rastreados; sem mudanças não cria", async () => {
    expect(await criarStash(repo)).toEqual({ criado: false, ref: null, hash: null });
    escrever(repo, "a.txt", "mudado\n");
    escrever(repo, "nr.txt", "nr\n");
    const sem = await criarStash(repo, { mensagem: "só rastreado" });
    expect(sem.criado).toBe(true);
    expect(existsSync(join(repo, "nr.txt"))).toBe(true);
    escrever(repo, "a.txt", "mudado 2\n");
    const com = await criarStash(repo, { mensagem: "-com opcao falsa", naoRastreados: true });
    expect(com.criado).toBe(true);
    expect(existsSync(join(repo, "nr.txt"))).toBe(false);
    const l = await listarStashes(repo);
    expect(l.map((s) => [s.indice, s.mensagem, s.ramo])).toEqual([
      [0, "On main: -com opcao falsa", "main"],
      [1, "On main: só rastreado", "main"],
    ]);
  });

  it("por caminhos (literal)", async () => {
    escrever(repo, "a.txt", "x\n");
    escrever(repo, "b.txt", "b\n");
    commit(repo, "b");
    escrever(repo, "a.txt", "alterado\n");
    escrever(repo, "b.txt", "alterado\n");
    await criarStash(repo, { caminhos: ["a.txt"] });
    expect(git(repo, "status", "--porcelain").trim()).toBe("M b.txt");
    await expect(criarStash(repo, { caminhos: ["../fora"] })).rejects.toThrow();
  });
});

describe("aplicar, pop, apagar, diff", () => {
  it("aplicar mantém o stash; pop remove", async () => {
    escrever(repo, "a.txt", "mudado\n");
    await criarStash(repo, { mensagem: "m" });
    const a = await aplicarStash(repo, 0);
    expect(a).toMatchObject({ aplicado: true, stashMantido: true });
    git(repo, "checkout", "--", "a.txt");
    const p = await popStash(repo);
    expect(p).toMatchObject({ aplicado: true, conflito: false, stashMantido: false });
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("mudado\n");
    expect(await listarStashes(repo)).toEqual([]);
  });

  it("pop com conflito NÃO apaga o stash", async () => {
    escrever(repo, "a.txt", "um\nstash\ntres\n");
    await criarStash(repo, { mensagem: "conflitante" });
    escrever(repo, "a.txt", "um\ncommitado\ntres\n");
    commit(repo, "muda a mesma linha");
    const p = await popStash(repo);
    expect(p).toMatchObject({ aplicado: false, conflito: true, arquivos: ["a.txt"], stashMantido: true });
    expect(await listarStashes(repo)).toHaveLength(1);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toContain("<<<<<<<");
  });

  it("pop com mudanças locais que seriam sobrescritas: falha sem conflito e mantém o stash", async () => {
    escrever(repo, "a.txt", "do stash\n");
    await criarStash(repo);
    escrever(repo, "a.txt", "mudança local nova\n");
    const p = await popStash(repo);
    expect(p).toMatchObject({ aplicado: false, conflito: false, stashMantido: true });
    expect(p.motivo).toBeTruthy();
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("mudança local nova\n");
  });

  it("apagar devolve hash e dá para restaurar; índice inexistente/malicioso é recusado", async () => {
    escrever(repo, "a.txt", "guardado\n");
    await criarStash(repo, { mensagem: "vai sumir" });
    const ap = await apagarStash(repo, 0);
    expect(await listarStashes(repo)).toEqual([]);
    await restaurarStashApagado(repo, ap.hash, ap.mensagem);
    expect((await listarStashes(repo))[0]?.hash).toBe(ap.hash);
    await expect(apagarStash(repo, 7)).rejects.toThrow(/inexistente/);
    await expect(popStash(repo, -1)).rejects.toThrow();
    await expect(popStash(repo, 1.5)).rejects.toThrow();
    await expect(restaurarStashApagado(repo, "--all", "x")).rejects.toThrow();
  });

  it("diff do stash inclui rastreados e não rastreados", async () => {
    escrever(repo, "a.txt", "um\nDOIS\ntres\n");
    escrever(repo, "novo.txt", "n1\nn2\n");
    await criarStash(repo, { naoRastreados: true });
    const d = await diffStash(repo, 0);
    const nomes = d.arquivos.map((a) => a.caminho).sort();
    expect(nomes).toEqual(["a.txt", "novo.txt"]);
    expect(d.arquivos.find((a) => a.caminho === "a.txt")).toMatchObject({ insercoes: 1, delecoes: 1 });
    expect(d.arquivos.find((a) => a.caminho === "novo.txt")?.estado).toBe("novo");
  });
});
