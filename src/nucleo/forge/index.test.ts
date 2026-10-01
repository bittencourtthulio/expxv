import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { abrirForge, criarForge } from "./index";
import { ForgeEntradaInvalidaErro } from "./erros";
import { criarFake, type Fake } from "../../../tests/fixtures/forge/ajudante";
import { git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../tests/fixtures/vcs/repos";

beforeAll(isolarConfigGit);
let raiz = "";
let fake: Fake | undefined;
afterEach(() => {
  if (raiz) removerPasta(raiz);
  raiz = "";
  fake?.limpar();
  fake = undefined;
});

describe("fábrica do Forge", () => {
  it("abrirForge escolhe o adaptador pelo hostname do remoto; sem remoto reconhecível devolve null (só git)", async () => {
    raiz = pastaTmp("forge-idx-");
    const r = initRepo(join(raiz, "r"));
    expect(await abrirForge({ cwd: r })).toBeNull();
    git(r, "remote", "add", "origin", "https://tok@gitlab.com/grupo/sub/proj.git");
    const f = await abrirForge({ cwd: r });
    expect(f).toMatchObject({ provedor: "gitlab", repo: { host: "gitlab.com", caminho: "grupo/sub/proj" } });
    git(r, "remote", "set-url", "origin", "git@bitbucket.org:ws/rp.git");
    expect((await abrirForge({ cwd: r }))?.provedor).toBe("bitbucket");
    git(r, "remote", "set-url", "origin", "https://dev.azure.com/org/proj/_git/rp");
    expect((await abrirForge({ cwd: r }))?.provedor).toBe("azure");
  });
  it("Enterprise desconhecido: reconhecido pela conta logada em `gh` (hostname)", async () => {
    raiz = pastaTmp("forge-idx-");
    const r = initRepo(join(raiz, "r"));
    git(r, "remote", "add", "origin", "git@git.acme.corp:acme/app.git");
    fake = criarFake([{ quando: ["--version"], saida: "gh version 2.50.0\n" }, { quando: ["auth", "status"], saida: "git.acme.corp\n  ✓ Logged in to git.acme.corp account thulio (keyring)\n  - Active account: true\n" }]);
    const f = await abrirForge({ cwd: r, executor: fake.executor, executaveis: { gh: fake.gh, glab: fake.glab }, env: fake.env });
    expect(f?.provedor).toBe("github");
    expect(f?.repo).toEqual({ host: "git.acme.corp", caminho: "acme/app" });
    const sem = await abrirForge({ cwd: r, executor: fake.executor, executaveis: { gh: join(fake.dir, "x"), glab: join(fake.dir, "y") } });
    expect(sem).toBeNull();
  });
  it("criarForge valida o repositório e declara capacidades por provedor", () => {
    expect(() => criarForge("github", { host: "github.com", caminho: "so-um" }, { cwd: "/tmp" })).toThrow(ForgeEntradaInvalidaErro);
    const gh = criarForge("github", { host: "github.com", caminho: "a/b" }, { cwd: "/tmp" });
    const az = criarForge("azure", { host: "dev.azure.com", caminho: "org/proj/repo" }, { cwd: "/tmp" });
    expect(gh.capacidades().prs.etag).toBe(true);
    expect(az.capacidades().issues.listar).toBe(false);
    expect(az.capacidades().prs.checkout).toBe(false);
  });
});
