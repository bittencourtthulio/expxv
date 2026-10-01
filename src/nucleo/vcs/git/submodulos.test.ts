import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectarEspeciais, ehArquivoLfs, lerPonteiroLfs, parsePonteiroLfs } from "./especiais";
import { inicializarSubmodulos, listarSubmodulos, ProtocoloBloqueadoErro } from "./submodulos";
import { criarVcsGit } from "./vcs-git";
import { commit, escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
let sub: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-sm-");
  sub = initRepo(join(raiz, "sub"));
  escrever(sub, "s.txt", "dentro do submodulo\n");
  commit(sub, "no submodulo");
  repo = initRepo(join(raiz, "r"));
  git(repo, "-c", "protocol.file.allow=always", "submodule", "add", "-q", `file://${sub}`, "libs/sub");
  const oid = "a".repeat(64);
  escrever(repo, "dados/grande.bin", `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 123456\n`);
  escrever(repo, ".gitattributes", "*.bin filter=lfs diff=lfs merge=lfs -text\n");
  commit(repo, "submodulo e lfs");
});
afterEach(() => removerPasta(raiz));

describe("submódulos", () => {
  it("lista com estado, ponteiro e URL sem credenciais; clone sem --recurse fica 'não inicializado' com aviso", async () => {
    const l = await listarSubmodulos(repo);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ caminho: "libs/sub", estado: "atual", url: `file://${sub}`, aviso: null });
    expect(l[0]?.hash).toBe(git(repo, "rev-parse", "HEAD:libs/sub").trim());

    const clone = join(raiz, "clone");
    git(raiz, "clone", "-q", `file://${repo}`, clone);
    const c = await listarSubmodulos(clone);
    expect(c[0]).toMatchObject({ estado: "nao-inicializado", hashAtual: null });
    expect(c[0]?.aviso).toMatch(/ponteiro/);
    const esp = await detectarEspeciais(clone);
    expect(esp.submodulos).toBe(1);
    expect(esp.avisos.join(" ")).toMatch(/submódulo/);
  });

  it("submódulo com commit novo vira 'divergente' (ponteiro); status/diff degradam sem quebrar", async () => {
    escrever(join(repo, "libs/sub"), "novo.txt", "n\n");
    git(join(repo, "libs/sub"), "config", "user.name", "T");
    git(join(repo, "libs/sub"), "config", "user.email", "t@example.invalid");
    commit(join(repo, "libs/sub"), "avanca");
    expect((await listarSubmodulos(repo))[0]?.estado).toBe("divergente");
    const v = criarVcsGit(repo, { confianca: "confiavel" });
    const s = await v.status();
    expect(s.arquivos.find((m) => m.caminho === "libs/sub")?.submodulo).toBeDefined();
    const d = await v.diff();
    expect(d.arquivos.find((a) => a.caminho === "libs/sub")?.submodulo).toBeDefined();
  });

  it("inicializar exige confirmação, usa file=user e inicializa só o pedido; caminho desconhecido/malicioso recusado", async () => {
    const clone = join(raiz, "clone");
    git(raiz, "clone", "-q", `file://${repo}`, clone);
    await expect(inicializarSubmodulos(clone, { confirmado: false })).rejects.toMatchObject({ motivo: "confirmacao-invalida" });
    for (const c of ["--all", "../x", "nao/e/submodulo"]) await expect(inicializarSubmodulos(clone, { confirmado: true, caminho: c })).rejects.toThrow();
    expect(existsSync(join(clone, "libs/sub/s.txt"))).toBe(false);
    await expect(inicializarSubmodulos(clone, { confirmado: true })).rejects.toBeInstanceOf(ProtocoloBloqueadoErro); // file:// em submódulo: bloqueado por padrão (file=user)
    expect(existsSync(join(clone, "libs/sub/s.txt"))).toBe(false);
    expect(await inicializarSubmodulos(clone, { confirmado: true, permitirArquivoLocal: true })).toEqual({ inicializados: ["libs/sub"] });
    expect(existsSync(join(clone, "libs/sub/s.txt"))).toBe(true);
    expect((await listarSubmodulos(clone))[0]?.estado).toBe("atual");
    expect(await inicializarSubmodulos(clone, { confirmado: true })).toEqual({ inicializados: [] });
  });

  it("URL ext:: do .gitmodules NUNCA executa comando (protocol.ext.allow=never)", async () => {
    const marca = join(raiz, "EXT-EXECUTOU");
    const mal = initRepo(join(raiz, "mal"));
    git(mal, "update-index", "--add", "--cacheinfo", `160000,${git(sub, "rev-parse", "HEAD").trim()},ruim`);
    escrever(mal, ".gitmodules", `[submodule "ruim"]\n\tpath = ruim\n\turl = ext::sh -c "touch ${marca}"\n`);
    git(mal, "add", ".gitmodules");
    git(mal, "commit", "-q", "-m", "submodulo malicioso");
    await expect(inicializarSubmodulos(mal, { confirmado: true })).rejects.toThrow();
    expect(existsSync(marca)).toBe(false);
  });
});

describe("LFS, sparse e clone parcial", () => {
  it("ponteiro LFS lido sem baixar nada; arquivo sob filter=lfs detectado; aviso de git-lfs ausente", async () => {
    const p = await lerPonteiroLfs(repo, "dados/grande.bin");
    expect(p).toEqual({ oid: "a".repeat(64), tamanho: 123456 });
    expect(await lerPonteiroLfs(repo, "a.txt")).toBeNull();
    expect(await lerPonteiroLfs(repo, "nao-existe.bin")).toBeNull();
    expect(await ehArquivoLfs(repo, "dados/grande.bin")).toBe(true);
    expect(await ehArquivoLfs(repo, "a.txt")).toBe(false);
    expect(parsePonteiroLfs("version https://git-lfs.github.com/spec/v1\noid sha256:xyz\nsize 1\n")).toBeNull();
    const e = await detectarEspeciais(repo);
    expect(e.lfs).toMatchObject({ configurado: true, padroes: ["*.bin"], instalado: false });
    expect(e.avisos.join(" ")).toMatch(/Git LFS.*ponteiros/);
    await expect(lerPonteiroLfs(repo, "../x")).rejects.toThrow();
  });

  it("sparse-checkout é respeitado (status não vê o que está fora) e aparece nos avisos", async () => {
    escrever(repo, "pasta1/a.txt", "1\n");
    escrever(repo, "pasta2/b.txt", "2\n");
    commit(repo, "pastas");
    git(repo, "sparse-checkout", "set", "--cone", "pasta1");
    expect(existsSync(join(repo, "pasta2/b.txt"))).toBe(false);
    const v = criarVcsGit(repo, { confianca: "confiavel" });
    expect((await v.status()).arquivos).toEqual([]);
    const e = await detectarEspeciais(repo);
    expect(e.sparse).toMatchObject({ ativo: true, cone: true });
    expect(e.sparse.padroes).toContain("pasta1");
    expect(e.avisos.join(" ")).toMatch(/Sparse-checkout/);
  });

  it("clone parcial (--filter): detectado; leituras seguem funcionando", async () => {
    const origem = join(raiz, "origem.git");
    git(raiz, "clone", "-q", "--bare", `file://${repo}`, origem);
    git(origem, "config", "uploadpack.allowFilter", "true");
    git(origem, "config", "uploadpack.allowAnySHA1InWant", "true");
    const parcial = join(raiz, "parcial");
    git(raiz, "-c", "protocol.file.allow=always", "clone", "-q", "--filter=blob:none", `file://${origem}`, parcial);
    const e = await detectarEspeciais(parcial);
    expect(e.parcial).toMatchObject({ ativo: true, remoto: "origin", filtro: "blob:none" });
    expect(e.avisos.join(" ")).toMatch(/Clone parcial/);
    const v = criarVcsGit(parcial, { confianca: "confiavel" });
    expect((await v.git.historico.log({ limite: 5 })).commits.length).toBeGreaterThan(0);
    expect((await v.status()).arquivos).toEqual([]);
  });
});

describe("repositório com submódulo E LFS: nenhuma função das fases 6A/6B quebra", () => {
  it("status, diff, log, blame, detalhe, ramos, stash, worktrees, commit, merge, reflog e remotos", async () => {
    const v = criarVcsGit(repo);
    escrever(repo, "a.txt", "um\nDOIS\ntres\n");
    escrever(repo, "dados/grande.bin", `version https://git-lfs.github.com/spec/v1\noid sha256:${"b".repeat(64)}\nsize 9\n`);
    escrever(repo, "libs/sub/solto.txt", "x\n");
    const s = await v.status();
    expect(s.arquivos.map((m) => m.caminho).sort()).toEqual(["a.txt", "dados/grande.bin", "libs/sub"]);
    const d = await v.diff();
    expect(d.arquivos.map((a) => a.caminho).sort()).toEqual(["a.txt", "dados/grande.bin"]);
    await v.git.estagio.estagiarArquivos(["a.txt", "dados/grande.bin"]);
    const c = await v.git.commit.criar({ mensagem: "feat: ponteiro lfs", origem: "usuario" });
    expect((await v.git.historico.detalhe(c.hash)).diff.arquivos).toHaveLength(2);
    expect((await v.git.historico.blame("dados/grande.bin")).length).toBe(3);
    expect((await v.git.historico.log({ limite: 10 })).commits[0]?.assunto).toBe("feat: ponteiro lfs");
    await v.git.ramos.criar("trabalho", { trocar: true });
    escrever(repo, "t.txt", "t\n");
    expect((await v.git.stash.criar({ naoRastreados: true })).criado).toBe(true);
    expect((await v.git.worktrees.listar()).length).toBe(1);
    expect((await v.git.operacoes.mesclar({ rev: "main", origem: "usuario" })).resultado).toBe("ja-atualizado");
    expect((await v.git.reflog.listar()).length).toBeGreaterThan(2);
    expect((await v.git.remotos.listar()).length).toBe(0);
    expect((await v.git.submodulos.listar())[0]?.caminho).toBe("libs/sub");
    expect((await v.git.especiais.detectar()).avisos.length).toBeGreaterThan(0);
    expect(await v.git.reflog.desfazerUltimaOperacao({ simular: true, origem: "usuario" })).toBeDefined();
  });
});
