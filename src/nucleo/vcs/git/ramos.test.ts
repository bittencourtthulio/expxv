import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { apagarRamo, apagarTag, arquivosDaRecusa, criarRamo, criarTag, definirUpstream, ehRamoPadrao, listarRamos, listarTags, parseTrack, ramoPadrao, removerUpstream, renomearRamo, trocarRamo } from "./ramos";
import { validarNomeRef } from "./comum";
import { commit, escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-rm-");
  repo = initRepo(join(raiz, "r"));
});
afterEach(() => removerPasta(raiz));

/** Remoto `file://` local e publicado. */
function comRemoto(): string {
  const bare = join(raiz, "remoto.git");
  git(raiz, "init", "-q", "--bare", "-b", "main", bare);
  git(repo, "remote", "add", "origin", `file://${bare}`);
  git(repo, "push", "-q", "-u", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");
  return bare;
}

describe("nomes de ref", () => {
  it("recusa nomes maliciosos (opção, .., espaço, controle, aspas) e aceita válidos", async () => {
    const ruins = ["-D", "--force", "-x", "a..b", "com espaco", "a\nb", "a\tb", "a'b", 'a"b', "a~1", "a^", "a:b", "a?b", "a*b", "a[b", "a\\b", "a@{u}", "@", "x.lock", "", "a//b", "/a", "a/", "\u0001x", "a\0b"];
    for (const n of ruins) await expect(validarNomeRef(repo, n)).rejects.toThrow();
    for (const n of ["feat/login", "fix-123", "v1.2.3", "a--b", "ç-ã"]) await expect(validarNomeRef(repo, n)).resolves.toBe(n);
    await expect(criarRamo(repo, "--orphan")).rejects.toThrow();
    await expect(renomearRamo(repo, "main", "-x")).rejects.toThrow();
    await expect(criarRamo(repo, "ok", { de: "--all" })).rejects.toThrow();
    await expect(criarRamo(repo, "ok", { de: "main..HEAD" })).rejects.toThrow();
    await expect(criarTag(repo, "-d")).rejects.toThrow();
    expect(git(repo, "branch", "--list").trim()).toBe("* main");
  });
});

describe("listar, criar, renomear, upstream, padrão", () => {
  it("lista locais e remotas com ahead/behind e último commit; detecta a padrão por origin/HEAD", async () => {
    comRemoto();
    await criarRamo(repo, "feat/x", { trocar: true });
    escrever(repo, "x.txt", "x\n");
    commit(repo, "no feat");
    git(repo, "push", "-q", "-u", "origin", "feat/x");
    escrever(repo, "y.txt", "y\n");
    commit(repo, "local a mais");
    const l = await listarRamos(repo);
    const feat = l.find((r) => r.nome === "feat/x")!;
    expect(feat).toMatchObject({ atual: true, remoto: false, upstream: "origin/feat/x", ahead: 1, behind: 0 });
    expect(feat.ultimoCommit).toMatchObject({ assunto: "local a mais", autor: "Teste" });
    expect(l.find((r) => r.nome === "origin/feat/x")?.remoto).toBe(true);
    expect(l.some((r) => r.nome === "origin/HEAD")).toBe(false);
    expect(await ramoPadrao(repo)).toBe("main");
    expect(await ehRamoPadrao(repo, "main")).toBe(true);
    expect(await ehRamoPadrao(repo, "feat/x")).toBe(false);
    expect(parseTrack("ahead 2, behind 3")).toEqual({ ahead: 2, behind: 3, sumiu: false });
    expect(parseTrack("gone").sumiu).toBe(true);
  });

  it("sem remoto, a padrão é main/master existente; criar a partir de ref e renomear; upstream", async () => {
    expect(await ramoPadrao(repo)).toBe("main");
    const inicial = git(repo, "rev-parse", "HEAD").trim();
    escrever(repo, "z.txt", "z\n");
    commit(repo, "segundo");
    const r = await criarRamo(repo, "velho", { de: inicial });
    expect(r.hash).toBe(inicial);
    await renomearRamo(repo, "velho", "antigo");
    expect(git(repo, "branch", "--list", "antigo").trim()).toBe("antigo");
    await expect(renomearRamo(repo, "antigo", "main")).rejects.toThrow(); // não sobrescreve
    comRemoto();
    await definirUpstream(repo, "antigo", "origin/main");
    expect((await listarRamos(repo)).find((x) => x.nome === "antigo")).toMatchObject({ upstream: "origin/main", behind: 1 });
    await removerUpstream(repo, "antigo");
    expect((await listarRamos(repo)).find((x) => x.nome === "antigo")?.upstream).toBeNull();
    await expect(definirUpstream(repo, "antigo", "origin/nao-existe")).rejects.toThrow(/inexistente/);
  });
});

describe("trocar", () => {
  function prepararConflito(): void {
    git(repo, "switch", "-q", "-c", "outra");
    escrever(repo, "a.txt", "versao da outra\n");
    commit(repo, "outra muda a.txt");
    git(repo, "switch", "-q", "main");
  }

  it("árvore suja SEM conflito leva as mudanças", async () => {
    git(repo, "branch", "outra");
    escrever(repo, "a.txt", "um\ndois\ntres\nquatro\n");
    const r = await trocarRamo(repo, "outra");
    expect(r).toMatchObject({ trocou: true, para: "outra" });
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toContain("quatro");
  });

  it("conflitante: cancelar devolve arquivos e não perde nada", async () => {
    prepararConflito();
    escrever(repo, "a.txt", "meu trabalho\n");
    const r = await trocarRamo(repo, "outra");
    expect(r).toMatchObject({ trocou: false, conflito: true, arquivos: ["a.txt"] });
    expect(git(repo, "branch", "--show-current").trim()).toBe("main");
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("meu trabalho\n");
    expect(git(repo, "stash", "list")).toBe("");
  });

  it("conflitante: levar (stash+pop) preserva; se o pop conflita o stash fica guardado", async () => {
    prepararConflito();
    escrever(repo, "a.txt", "meu trabalho\n");
    escrever(repo, "nao-rastreado.txt", "nr\n");
    const r = await trocarRamo(repo, "outra", { estrategia: "levar" });
    expect(r).toMatchObject({ trocou: true, para: "outra", conflitoAoReaplicar: true });
    expect(git(repo, "stash", "list")).toContain("troca main -> outra");
    // o trabalho está no stash E (com marcadores) na árvore; nada se perdeu
    const stash = git(repo, "stash", "show", "-p", "--include-untracked", "stash@{0}");
    expect(stash).toContain("meu trabalho");
    expect(stash).toContain("nr");
  });

  it("conflitante: stash guarda e troca; arquivo não rastreado em conflito também é tratado", async () => {
    git(repo, "switch", "-q", "-c", "outra");
    escrever(repo, "nr.txt", "da outra\n");
    commit(repo, "outra tem nr.txt");
    git(repo, "switch", "-q", "main");
    escrever(repo, "nr.txt", "meu nao rastreado\n");
    const c = await trocarRamo(repo, "outra");
    expect(c).toMatchObject({ trocou: false, conflito: true, arquivos: ["nr.txt"] });
    const r = await trocarRamo(repo, "outra", { estrategia: "stash" });
    expect(r).toMatchObject({ trocou: true, stashCriado: "stash@{0}", levouMudancas: false });
    expect(readFileSync(join(repo, "nr.txt"), "utf8")).toBe("da outra\n");
    expect(git(repo, "show", "stash@{0}^3:nr.txt")).toBe("meu nao rastreado\n");
  });

  it("destino inexistente ou malicioso é recusado; remota cria tracking local", async () => {
    await expect(trocarRamo(repo, "nao-existe")).rejects.toThrow(/inexistente/);
    await expect(trocarRamo(repo, "--detach")).rejects.toThrow();
    comRemoto();
    git(repo, "switch", "-q", "-c", "so-remota");
    escrever(repo, "s.txt", "s\n");
    commit(repo, "s");
    git(repo, "push", "-q", "origin", "so-remota");
    git(repo, "switch", "-q", "main");
    git(repo, "branch", "-q", "-D", "so-remota");
    const r = await trocarRamo(repo, "origin/so-remota");
    expect(r).toMatchObject({ trocou: true, para: "so-remota" });
    expect(git(repo, "rev-parse", "--abbrev-ref", "so-remota@{upstream}").trim()).toBe("origin/so-remota");
  });

  it("parser da recusa do git", () => {
    expect(arquivosDaRecusa("error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\n\tb/c.txt\nPlease commit your changes or stash them before you switch branches.\nAborting\n")).toEqual(["a.txt", "b/c.txt"]);
  });
});

describe("apagar", () => {
  it("mesclada: apaga com -d; atual e inexistente são recusadas", async () => {
    git(repo, "branch", "mesclada");
    expect((await apagarRamo(repo, "mesclada")).apagado).toBe(true);
    await expect(apagarRamo(repo, "main")).rejects.toThrow(/atual/);
    await expect(apagarRamo(repo, "nope")).rejects.toThrow(/inexistente/);
  });

  it("não mesclada exige forcar, mostra órfãos antes e devolve o hash para recuperar", async () => {
    git(repo, "switch", "-q", "-c", "trabalho");
    escrever(repo, "t.txt", "t\n");
    commit(repo, "commit 1");
    escrever(repo, "t.txt", "t2\n");
    commit(repo, "commit 2");
    git(repo, "switch", "-q", "main");
    const ponta = git(repo, "rev-parse", "trabalho").trim();

    const sim = await apagarRamo(repo, "trabalho", { simular: true });
    expect(sim).toMatchObject({ apagado: false, simulado: true, requerForcar: true });
    expect(sim.orfaos.map((c) => c.assunto)).toEqual(["commit 2", "commit 1"]);

    const negado = await apagarRamo(repo, "trabalho");
    expect(negado).toMatchObject({ apagado: false, requerForcar: true });
    expect(git(repo, "branch", "--list", "trabalho").trim()).toBe("trabalho");

    const ok = await apagarRamo(repo, "trabalho", { forcar: true });
    expect(ok).toMatchObject({ apagado: true, hashAnterior: ponta });
    expect(git(repo, "branch", "--list", "trabalho")).toBe("");
    await criarRamo(repo, "trabalho", { de: ok.hashAnterior });
    expect(git(repo, "rev-parse", "trabalho").trim()).toBe(ponta);
  });

  it("commits que outra ref alcança não são órfãos (apaga sem forçar)", async () => {
    git(repo, "switch", "-q", "-c", "a");
    escrever(repo, "a2.txt", "a\n");
    commit(repo, "so em a");
    git(repo, "branch", "b"); // b aponta para o mesmo commit
    git(repo, "switch", "-q", "main");
    const r = await apagarRamo(repo, "a");
    expect(r).toMatchObject({ apagado: true, orfaos: [] });
  });
});

describe("tags", () => {
  it("cria leve e anotada, lista, apaga localmente", async () => {
    const h = git(repo, "rev-parse", "HEAD").trim();
    expect(await criarTag(repo, "v1")).toMatchObject({ tipo: "leve", hash: h });
    expect(await criarTag(repo, "v2", { mensagem: "versão 2\n\ndetalhes" })).toMatchObject({ tipo: "anotada" });
    const t = await listarTags(repo);
    expect(t.find((x) => x.nome === "v1")).toMatchObject({ tipo: "leve", hash: h, mensagem: null });
    expect(t.find((x) => x.nome === "v2")).toMatchObject({ tipo: "anotada", hash: h, mensagem: "versão 2", autor: "Teste" });
    const ap = await apagarTag(repo, "v1");
    expect(ap.objetoAnterior).toBe(h);
    expect((await listarTags(repo)).map((x) => x.nome)).toEqual(["v2"]);
    await expect(apagarTag(repo, "v1")).rejects.toThrow(/inexistente/);
    await expect(criarTag(repo, "v2")).rejects.toThrow(); // já existe: nunca move
  });
});
