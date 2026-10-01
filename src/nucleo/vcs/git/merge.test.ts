import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abortar, cherryPick, continuar, estadoOperacao, mesclar, pular, rebase, rebaseInterativo, reverter } from "./merge";
import { aplicarResolucoes, classificarConflito, ConflitoNaoTextualErro, ConflitoPendenteErro, lerConflitos, listarConflitos, marcarResolvido, parseConflitos, resolverArquivo, resolverHunks, ResolucaoInvalidaErro } from "./conflitos";
import { OperacaoRecusadaErro } from "./guardas";
import { commit, escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-mg-");
  repo = initRepo(join(raiz, "r"));
});
afterEach(() => removerPasta(raiz));

const foto = (): string => `${git(repo, "rev-parse", "HEAD").trim()}|${git(repo, "symbolic-ref", "-q", "HEAD").trim()}|${git(repo, "status", "--porcelain=v1", "--branch")}`;

/** main e `lado` divergem editando a MESMA linha de c.txt. */
function conflitoSimples(): void {
  escrever(repo, "c.txt", "a\nb\nc\n");
  commit(repo, "base c");
  git(repo, "switch", "-q", "-c", "lado");
  escrever(repo, "c.txt", "a\nB-lado\nc\n");
  commit(repo, "lado muda b");
  git(repo, "switch", "-q", "main");
  escrever(repo, "c.txt", "a\nB-main\nc\n");
  commit(repo, "main muda b");
}

describe("merge", () => {
  it("merge limpo, 'ja-atualizado' e simulação (nada muda; conflitos previstos)", async () => {
    git(repo, "switch", "-q", "-c", "t1");
    escrever(repo, "x.txt", "x\n");
    commit(repo, "x");
    git(repo, "switch", "-q", "main");
    const antes = foto();
    const sim = await mesclar(repo, { rev: "t1", origem: "usuario", simular: true });
    expect(sim).toMatchObject({ resultado: "simulado", conflitosPrevistos: [] });
    expect(sim.commits?.map((c) => c.assunto)).toEqual(["x"]);
    expect(foto()).toBe(antes);
    expect((await mesclar(repo, { rev: "t1", origem: "usuario" })).resultado).toBe("ok");
    expect((await mesclar(repo, { rev: "t1", origem: "usuario" })).resultado).toBe("ja-atualizado");
  });

  it("conflito: estado, hunks, resolver por hunk, marcar e continuar; abortar restaura o estado exato", async () => {
    conflitoSimples();
    const antes = foto();
    const sim = await mesclar(repo, { rev: "lado", origem: "usuario", simular: true });
    expect(sim.conflitosPrevistos).toEqual(["c.txt"]);
    const r = await mesclar(repo, { rev: "lado", origem: "usuario" });
    expect(r).toMatchObject({ resultado: "conflito", conflitos: ["c.txt"] });
    expect(r.estado).toMatchObject({ operacao: "merge", parado: "conflito" });
    expect(await listarConflitos(repo)).toEqual([{ caminho: "c.txt", tipo: "texto", opcoes: ["nossa", "deles"], hunks: 1 }]);
    await abortar(repo);
    expect(foto()).toBe(antes);
    expect((await estadoOperacao(repo)).operacao).toBeNull();

    await mesclar(repo, { rev: "lado", origem: "usuario" });
    await expect(continuar(repo)).rejects.toMatchObject({ motivo: "conflitos-pendentes" });
    const m = await lerConflitos(repo, "c.txt");
    expect(m.hunks[0]).toMatchObject({ nossa: "B-main\n", deles: "B-lado\n", base: null });
    expect(await resolverHunks(repo, "c.txt", { 0: "ambas" })).toEqual({ restantes: 0, marcado: true });
    expect(readFileSync(join(repo, "c.txt"), "utf8")).toBe("a\nB-main\nB-lado\nc\n");
    const f = await continuar(repo);
    expect(f.resultado).toBe("ok");
    expect(git(repo, "log", "-1", "--format=%P").trim().split(" ")).toHaveLength(2);
  });

  it("automação nunca opera na branch padrão (merge, rebase, cherry-pick, revert) e aceita branch de trabalho", async () => {
    git(repo, "switch", "-q", "-c", "t1");
    escrever(repo, "x.txt", "x\n");
    commit(repo, "x");
    git(repo, "switch", "-q", "main");
    const h = git(repo, "rev-parse", "t1").trim();
    const antes = foto();
    for (const f of [
      () => mesclar(repo, { rev: "t1", origem: "automacao" }),
      () => rebase(repo, { base: "t1", origem: "automacao" }),
      () => cherryPick(repo, { revs: [h], origem: "automacao" }),
      () => reverter(repo, { revs: ["HEAD"], origem: "automacao" }),
      () => mesclar(repo, { rev: "t1", origem: "automacao", simular: true }),
    ]) await expect(f()).rejects.toMatchObject({ name: "OperacaoRecusadaErro", motivo: "automacao-ramo-padrao" });
    await expect(mesclar(repo, { rev: "t1", origem: "x" as never })).rejects.toBeInstanceOf(OperacaoRecusadaErro);
    expect(foto()).toBe(antes);
    git(repo, "switch", "-q", "-c", "trabalho");
    expect((await cherryPick(repo, { revs: [h], origem: "automacao" })).resultado).toBe("ok");
  });

  it("revs maliciosas nunca viram opção", async () => {
    git(repo, "switch", "-q", "-c", "trabalho");
    for (const r of ["--abort", "-x", "--exec=touch /tmp/pwn-mg", "a b", "--", "HEAD..HEAD"]) {
      await expect(mesclar(repo, { rev: r, origem: "usuario" })).rejects.toThrow();
      await expect(rebase(repo, { base: r, origem: "usuario" })).rejects.toThrow();
      await expect(cherryPick(repo, { revs: [r], origem: "usuario" })).rejects.toThrow();
      await expect(reverter(repo, { revs: [r], origem: "usuario" })).rejects.toThrow();
    }
    expect(existsSync("/tmp/pwn-mg")).toBe(false);
  });

  it("cherry-pick com conflito: pular devolve ao estado de antes; revert cria commit inverso", async () => {
    conflitoSimples();
    const lado = git(repo, "rev-parse", "lado").trim();
    const antes = foto();
    const r = await cherryPick(repo, { revs: [lado], origem: "usuario" });
    expect(r).toMatchObject({ resultado: "conflito", estado: { operacao: "cherry-pick" } });
    await pular(repo);
    expect(foto()).toBe(antes);
    expect((await reverter(repo, { revs: ["HEAD"], origem: "usuario" })).resultado).toBe("ok");
    expect(readFileSync(join(repo, "c.txt"), "utf8")).toBe("a\nb\nc\n");
  });
});

describe("rebase com conflitos em sequência", () => {
  /** feature com 3 commits (f1, f2, f3), main altera as mesmas linhas: 3 conflitos, um por commit. */
  function preparar(): void {
    for (const n of [1, 2, 3]) escrever(repo, `f${n}.txt`, "a\nb\nc\n");
    commit(repo, "arquivos");
    git(repo, "switch", "-q", "-c", "feature");
    for (const n of [1, 2, 3]) {
      escrever(repo, `f${n}.txt`, `a\nfeature${n}\nc\n`);
      commit(repo, `feature ${n}`);
    }
    git(repo, "switch", "-q", "main");
    for (const n of [1, 2, 3]) escrever(repo, `f${n}.txt`, `a\nmain${n}\nc\n`);
    commit(repo, "main altera tudo");
    git(repo, "switch", "-q", "feature");
  }

  it("3 conflitos resolvidos só pela API; passo/total no estado", async () => {
    preparar();
    let r = await rebase(repo, { base: "main", origem: "usuario" });
    for (const n of [1, 2, 3]) {
      expect(r.resultado).toBe("conflito");
      expect(r.estado).toMatchObject({ operacao: "rebase", passo: n, total: 3, ramo: "feature", parado: "conflito", conflitos: [`f${n}.txt`] });
      expect((await resolverHunks(repo, `f${n}.txt`, { 0: { editar: `resolvido${n}\n` } })).marcado).toBe(true);
      r = await continuar(repo);
    }
    expect(r.resultado).toBe("ok");
    expect(r.estado.operacao).toBeNull();
    expect(git(repo, "log", "--format=%s", "main..feature").trim().split("\n")).toEqual(["feature 3", "feature 2", "feature 1"]);
    for (const n of [1, 2, 3]) expect(readFileSync(join(repo, `f${n}.txt`), "utf8")).toBe(`a\nresolvido${n}\nc\n`);
  });

  it("abortar no meio restaura HEAD, branch e status EXATOS", async () => {
    preparar();
    const antes = foto();
    await rebase(repo, { base: "main", origem: "usuario" });
    await resolverHunks(repo, "f1.txt", { 0: "deles" });
    await continuar(repo); // vai para o 2º conflito
    expect((await estadoOperacao(repo)).passo).toBe(2);
    const r = await abortar(repo);
    expect(r.estado.operacao).toBeNull();
    expect(foto()).toBe(antes);
    expect(git(repo, "status", "--porcelain").trim()).toBe("");
  });

  it("pular um passo continua o rebase", async () => {
    preparar();
    await rebase(repo, { base: "main", origem: "usuario" });
    await pular(repo);
    expect((await estadoOperacao(repo)).passo).toBe(2);
    await abortar(repo);
  });
});

describe("rebase interativo sem editor", () => {
  function quatro(): string[] {
    git(repo, "switch", "-q", "-c", "feat");
    const hs: string[] = [];
    for (const n of [1, 2, 3, 4]) {
      escrever(repo, `i${n}.txt`, `${n}\n`);
      commit(repo, `c${n}`);
      hs.push(git(repo, "rev-parse", "HEAD").trim());
    }
    return hs;
  }
  const pastasTmp = (): string[] => readdirSync(tmpdir()).filter((p) => p.startsWith("ade-rebase-"));

  it("reword + squash + drop + reordenar a partir de lista estruturada; pasta temporária some", async () => {
    const [c1, c2, c3, c4] = quatro() as [string, string, string, string];
    const antes = pastasTmp().length;
    const r = await rebaseInterativo(repo, {
      base: "main", origem: "usuario",
      passos: [
        { acao: "reword", hash: c1.slice(0, 8), mensagem: "feat: primeiro reescrito\n\ncorpo 'novo' \"aspas\"" },
        { acao: "squash", hash: c2 },
        { acao: "drop", hash: c3 },
        { acao: "pick", hash: c4 },
      ],
    });
    expect(r.resultado).toBe("ok");
    expect(git(repo, "log", "--format=%s", "main..feat").trim().split("\n")).toEqual(["c4", "feat: primeiro reescrito"]);
    expect(git(repo, "log", "--format=%B", "-n1", "HEAD~1")).toContain("corpo 'novo' \"aspas\"");
    expect(existsSync(join(repo, "i1.txt")) && existsSync(join(repo, "i2.txt")) && !existsSync(join(repo, "i3.txt")) && existsSync(join(repo, "i4.txt"))).toBe(true);
    expect(pastasTmp().length).toBe(antes);
    expect(existsSync(join(repo, ".git", "ade-rebase-tmp"))).toBe(false);
  });

  it("edit para o rebase; continuar conclui; reword não perde a pasta temporária enquanto parado", async () => {
    const [c1, c2, c3, c4] = quatro() as [string, string, string, string];
    const r = await rebaseInterativo(repo, { base: "main", origem: "usuario", passos: [{ acao: "pick", hash: c1 }, { acao: "edit", hash: c2 }, { acao: "reword", hash: c3, mensagem: "tres" }, { acao: "fixup", hash: c4 }] });
    expect(r.resultado).toBe("parado");
    expect(r.estado).toMatchObject({ operacao: "rebase", interativo: true, parado: "parado" });
    expect(existsSync(join(repo, ".git", "ade-rebase-tmp"))).toBe(true);
    const f = await continuar(repo);
    expect(f.resultado).toBe("ok");
    expect(git(repo, "log", "--format=%s", "main..feat").trim().split("\n")).toEqual(["tres", "c2", "c1"]);
    expect(existsSync(join(repo, ".git", "ade-rebase-tmp"))).toBe(false);
  });

  it("recusa passos inválidos, publicados (salvo forcar) e simula o que seria descartado", async () => {
    const [c1, c2, c3, c4] = quatro() as [string, string, string, string];
    const base = { base: "main", origem: "usuario" as const };
    for (const passos of [
      [{ acao: "squash" as const, hash: c1 }, { acao: "pick" as const, hash: c2 }, { acao: "pick" as const, hash: c3 }, { acao: "pick" as const, hash: c4 }],
      [{ acao: "pick" as const, hash: c1 }],
      [{ acao: "reword" as const, hash: c1 }, { acao: "pick" as const, hash: c2 }, { acao: "pick" as const, hash: c3 }, { acao: "pick" as const, hash: c4 }],
      [{ acao: "pick" as const, hash: "--abort" }, { acao: "pick" as const, hash: c2 }, { acao: "pick" as const, hash: c3 }, { acao: "pick" as const, hash: c4 }],
      [{ acao: "rm" as never, hash: c1 }, { acao: "pick" as const, hash: c2 }, { acao: "pick" as const, hash: c3 }, { acao: "pick" as const, hash: c4 }],
    ]) await expect(rebaseInterativo(repo, { ...base, passos })).rejects.toMatchObject({ motivo: "passos-invalidos" });
    const tudo = [c1, c2, c3, c4].map((hash) => ({ acao: "pick" as const, hash }));
    const sim = await rebaseInterativo(repo, { ...base, simular: true, passos: [{ acao: "drop", hash: c1 }, ...tudo.slice(1)] });
    expect(sim.descartados?.map((c) => c.assunto)).toEqual(["c1"]);
    expect(git(repo, "log", "--format=%s", "main..feat").trim().split("\n")).toHaveLength(4);

    const bare = join(raiz, "remoto.git");
    git(raiz, "init", "-q", "--bare", "-b", "main", bare);
    git(repo, "remote", "add", "origin", `file://${bare}`);
    git(repo, "push", "-q", "-u", "origin", "feat");
    await expect(rebaseInterativo(repo, { ...base, passos: tudo })).rejects.toMatchObject({ motivo: "publicado", detalhe: expect.arrayContaining([c1]) });
    const ok = await rebaseInterativo(repo, { ...base, forcar: true, passos: tudo });
    expect(ok.resultado === "ok" || ok.resultado === "ja-atualizado").toBe(true);
    expect(ok.avisosTexto?.[0]).toMatch(/já publicados/);
  });

  it("automação na branch padrão é recusada; operação em curso bloqueia nova operação", async () => {
    await expect(rebaseInterativo(repo, { base: "HEAD", origem: "automacao", passos: [] })).rejects.toMatchObject({ motivo: "automacao-ramo-padrao" });
    conflitoSimples();
    await mesclar(repo, { rev: "lado", origem: "usuario" });
    await expect(mesclar(repo, { rev: "lado", origem: "usuario" })).rejects.toMatchObject({ motivo: "operacao-em-curso" });
    await abortar(repo);
    await expect(abortar(repo)).rejects.toMatchObject({ motivo: "sem-operacao" });
  });
});

describe("marcadores: merge, diff3 e zdiff3", () => {
  it("parser: estilo merge e diff3 (com base), CRLF preservado, hunk sem fechamento vira texto", () => {
    const m = parseConflitos("antes\n<<<<<<< HEAD\nnossa\n=======\ndeles\n>>>>>>> feature\ndepois\n");
    expect(m.estilo).toBe("merge");
    expect(m.hunks[0]).toMatchObject({ rotuloNossa: "HEAD", rotuloDeles: "feature", nossa: "nossa\n", deles: "deles\n", base: null, linha: 2 });
    const d = parseConflitos("<<<<<<< HEAD\r\nn\r\n||||||| base\r\nb\r\n=======\r\nd\r\n>>>>>>> x\r\ncauda\r\n");
    expect(d.estilo).toBe("diff3");
    expect(d.hunks[0]).toMatchObject({ base: "b\r\n", nossa: "n\r\n", deles: "d\r\n" });
    expect(aplicarResolucoes(d, { 0: "ambas" }, "\r\n").texto).toBe("n\r\nd\r\ncauda\r\n");
    expect(aplicarResolucoes(d, { 0: "base" }, "\r\n").texto).toBe("b\r\ncauda\r\n");
    expect(aplicarResolucoes(d, {}, "\r\n").texto).toBe("<<<<<<< HEAD\r\nn\r\n||||||| base\r\nb\r\n=======\r\nd\r\n>>>>>>> x\r\ncauda\r\n");
    const aberto = parseConflitos("x\n<<<<<<< HEAD\ny\n");
    expect(aberto.hunks).toHaveLength(0);
    expect(aplicarResolucoes(aberto, {}).texto).toBe("x\n<<<<<<< HEAD\ny\n");
    expect(() => aplicarResolucoes(parseConflitos("<<<<<<< a\nx\n=======\ny\n>>>>>>> b\n"), { 0: "base" })).toThrow(ResolucaoInvalidaErro);
    expect(parseConflitos("# titulo\n=======\ntexto\n").hunks).toHaveLength(0);
  });

  it("zdiff3 real: dois hunks, resolve um por vez; marcar resolvido recusa marcadores restantes", async () => {
    git(repo, "config", "merge.conflictStyle", "zdiff3");
    escrever(repo, "z.txt", "1\nA\n3\n4\n5\n6\n7\nB\n9\n");
    commit(repo, "base z");
    git(repo, "switch", "-q", "-c", "lado");
    escrever(repo, "z.txt", "1\nA-lado\n3\n4\n5\n6\n7\nB-lado\n9\n");
    commit(repo, "lado");
    git(repo, "switch", "-q", "main");
    escrever(repo, "z.txt", "1\nA-main\n3\n4\n5\n6\n7\nB-main\n9\n");
    commit(repo, "main");
    await mesclar(repo, { rev: "lado", origem: "usuario" });
    const m = await lerConflitos(repo, "z.txt");
    expect(m.estilo).toBe("diff3");
    expect(m.hunks.map((h) => h.base)).toEqual(["A\n", "B\n"]);
    expect(await resolverHunks(repo, "z.txt", { 1: "deles" })).toEqual({ restantes: 1, marcado: false });
    await expect(marcarResolvido(repo, "z.txt")).rejects.toBeInstanceOf(ConflitoPendenteErro);
    expect(await resolverHunks(repo, "z.txt", { 0: "base" })).toEqual({ restantes: 0, marcado: true });
    expect(readFileSync(join(repo, "z.txt"), "utf8")).toBe("1\nA\n3\n4\n5\n6\n7\nB-lado\n9\n");
    await expect(resolverHunks(repo, "z.txt", { 7: "nossa" })).rejects.toThrow();
    await abortar(repo);
  });
});

describe("conflitos que não são de texto", () => {
  it("exclusão x modificação, binário e modo viram erro nominal com opções; resolvíveis por arquivo", async () => {
    escrever(repo, "del.txt", "x\ny\n");
    escrever(repo, "bin.dat", Buffer.from([0, 1, 2, 3]));
    escrever(repo, "exe.sh", "#!/bin/sh\n");
    commit(repo, "base");
    git(repo, "switch", "-q", "-c", "lado");
    escrever(repo, "del.txt", "x\nY\n");
    escrever(repo, "bin.dat", Buffer.from([0, 9, 9, 9]));
    git(repo, "update-index", "--chmod=+x", "exe.sh");
    escrever(repo, "exe.sh", "#!/bin/sh\necho lado\n");
    commit(repo, "lado");
    git(repo, "switch", "-q", "main");
    git(repo, "rm", "-q", "del.txt");
    escrever(repo, "bin.dat", Buffer.from([0, 7, 7, 7]));
    escrever(repo, "exe.sh", "#!/bin/sh\necho main\n");
    git(repo, "update-index", "--chmod=-x", "exe.sh");
    commit(repo, "main");
    const r = await mesclar(repo, { rev: "lado", origem: "usuario" });
    expect(r.resultado).toBe("conflito");
    const tipos = Object.fromEntries((await listarConflitos(repo)).map((c) => [c.caminho, c.tipo]));
    expect(tipos["del.txt"]).toBe("exclusao-modificacao");
    expect(tipos["bin.dat"]).toBe("binario");
    expect(await classificarConflito(repo, "del.txt")).toMatchObject({ lado: "nos-apagamos", opcoes: ["deles", "remover"] });
    await expect(lerConflitos(repo, "bin.dat")).rejects.toBeInstanceOf(ConflitoNaoTextualErro);
    await expect(resolverArquivo(repo, "del.txt", "nossa")).rejects.toMatchObject({ name: "OperacaoRecusadaErro" });
    await resolverArquivo(repo, "del.txt", "remover");
    await resolverArquivo(repo, "bin.dat", "deles");
    expect([...r.avisos.map((a) => a.tipo)]).toEqual(expect.arrayContaining(["modify/delete"]));
    expect([...new Set((await estadoOperacao(repo)).conflitos)].every((c) => c !== "del.txt" && c !== "bin.dat")).toBe(true);
    expect(readFileSync(join(repo, "bin.dat")).equals(Buffer.from([0, 9, 9, 9]))).toBe(true);
    const restante = (await estadoOperacao(repo)).conflitos;
    for (const c of restante) await resolverArquivo(repo, c, "nossa");
    expect((await continuar(repo)).resultado).toBe("ok");
    writeFileSync(join(repo, "ok.txt"), "x");
  });

  it("caminho malicioso ou fora da raiz nunca é lido nem escrito", async () => {
    conflitoSimples();
    await mesclar(repo, { rev: "lado", origem: "usuario" });
    for (const c of ["../x", "/etc/passwd", "a\0b"]) await expect(lerConflitos(repo, c)).rejects.toThrow();
    await expect(resolverHunks(repo, "../x", { 0: "nossa" })).rejects.toThrow();
    await abortar(repo);
  });
});
