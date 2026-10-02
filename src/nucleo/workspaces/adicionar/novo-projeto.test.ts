import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExecutorVcs } from "../../vcs/executor";
import { git, isolarConfigGit, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";
import { ErroAdicionarNucleo } from "./erros";
import { AVISO_SEM_IDENTIDADE, criarNovoProjeto, type OpcoesNovoProjeto } from "./novo-projeto";
import { caminhoRelativoSeguro, gerarTemplate, slugDoProjeto } from "./templates";

let raiz: string;
let pai: string;
const executor = new ExecutorVcs();
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("adic-novo-");
  pai = join(raiz, "projetos");
  mkdirSync(pai);
});
afterEach(() => {
  isolarConfigGit();
  removerPasta(raiz);
});

const base = (o: Partial<OpcoesNovoProjeto> = {}): OpcoesNovoProjeto => ({ executor, pai, nome: "meu-app", git: true, gitignore: true, commit_inicial: false, readme: true, template: "vazio", ...o });
const comIdentidade = (): void => {
  const cfg = join(raiz, "gitconfig-teste");
  writeFileSync(cfg, "[user]\n\tname = Teste\n\temail = teste@example.invalid\n");
  process.env.GIT_CONFIG_GLOBAL = cfg;
};

describe("templates (puros)", () => {
  it("vazio: só README e .gitignore quando pedidos", () => {
    expect(gerarTemplate({ nome: "x", template: "vazio", readme: false, gitignore: false })).toEqual([]);
    expect(gerarTemplate({ nome: "x", template: "vazio", readme: true, gitignore: false }).map((a) => a.caminho)).toEqual(["README.md"]);
    const g = gerarTemplate({ nome: "x", template: "vazio", readme: false, gitignore: true });
    expect(g.map((a) => a.caminho)).toEqual([".gitignore"]);
    expect(g[0]?.conteudo).toContain(".DS_Store");
    expect(g[0]?.conteudo).toContain("!.env.example");
  });
  it("node: package.json mínimo e válido, sem dependências nem scripts que executem", () => {
    const a = gerarTemplate({ nome: "Meu App Legal!", template: "node", readme: false, gitignore: true });
    const pj = JSON.parse(a.find((x) => x.caminho === "package.json")?.conteudo ?? "{}") as Record<string, unknown>;
    expect(pj).toMatchObject({ name: "meu-app-legal", version: "0.1.0", private: true, scripts: {} });
    expect(pj.dependencies).toBeUndefined();
    expect(a.find((x) => x.caminho === ".gitignore")?.conteudo).toContain("node_modules/");
  });
  it("python: pyproject mínimo sem dependências", () => {
    const a = gerarTemplate({ nome: "Análise Dados", template: "python", readme: false, gitignore: true });
    const t = a.find((x) => x.caminho === "pyproject.toml")?.conteudo ?? "";
    expect(t).toContain('name = "analise-dados"');
    expect(t).toContain("dependencies = []");
    expect(a.find((x) => x.caminho === ".gitignore")?.conteudo).toContain(".venv/");
  });
  it("docs: docs/index.md + README (README sempre)", () => {
    const a = gerarTemplate({ nome: "Manual", template: "docs", readme: false, gitignore: false });
    expect(a.map((x) => x.caminho).sort()).toEqual(["README.md", "docs/index.md"]);
  });
  it("nenhum caminho gerado escapa da pasta (relativo, sem .., sem raiz)", () => {
    for (const template of ["vazio", "node", "python", "docs"] as const) {
      for (const a of gerarTemplate({ nome: "../../etc/x\n# injeção", template, readme: true, gitignore: true })) expect(caminhoRelativoSeguro(a.caminho), a.caminho).toBe(true);
    }
    for (const ruim of ["/etc/passwd", "../x", "a/../b", "a//b", "C:\\x", "a\\b", "", "./x", "a\0b"]) expect(caminhoRelativoSeguro(ruim), ruim).toBe(false);
  });
  it("título do README nunca quebra linha (sem injeção de markdown em várias linhas)", () => {
    const a = gerarTemplate({ nome: "linha1\nlinha2", template: "vazio", readme: true, gitignore: false });
    expect(a[0]?.conteudo).toBe("# linha1 linha2\n");
  });
  it("slug", () => {
    expect(slugDoProjeto("  Olá, Mundo!! ")).toBe("ola-mundo");
    expect(slugDoProjeto("!!!")).toBe("projeto");
  });
});

describe("criarNovoProjeto", () => {
  it("pasta vazia + git (ramo main), sem commit por padrão", async () => {
    const r = await criarNovoProjeto(base({ readme: false, gitignore: false }));
    expect(r.caminho).toBe(join(pai, "meu-app"));
    expect(git(r.caminho, "symbolic-ref", "--short", "HEAD").trim()).toBe("main");
    expect(r.commitFeito).toBe(false);
    expect(readdirSync(r.caminho)).toEqual([".git"]);
  });
  it("sem git: só os arquivos do template", async () => {
    const r = await criarNovoProjeto(base({ git: false, template: "node" }));
    expect(existsSync(join(r.caminho, ".git"))).toBe(false);
    expect(existsSync(join(r.caminho, "package.json"))).toBe(true);
    expect(existsSync(join(r.caminho, ".gitignore"))).toBe(false); // .gitignore só faz sentido com git
  });
  it("commit inicial com identidade do usuário", async () => {
    comIdentidade();
    const r = await criarNovoProjeto(base({ commit_inicial: true, template: "docs" }));
    expect(r.commitFeito).toBe(true);
    expect(git(r.caminho, "log", "--format=%an|%s").trim()).toBe("Teste|Commit inicial");
    expect(git(r.caminho, "ls-files").trim().split("\n").sort()).toEqual([".gitignore", "README.md", "docs/index.md"]);
  });
  it("commit inicial em pasta vazia usa commit vazio (ramo existe)", async () => {
    comIdentidade();
    const r = await criarNovoProjeto(base({ commit_inicial: true, readme: false, gitignore: false }));
    expect(r.commitFeito).toBe(true);
    expect(git(r.caminho, "rev-list", "--count", "HEAD").trim()).toBe("1");
  });
  it("sem identidade git: NÃO commita e avisa", async () => {
    const r = await criarNovoProjeto(base({ commit_inicial: true }));
    expect(r.commitFeito).toBe(false);
    expect(r.avisos).toEqual([AVISO_SEM_IDENTIDADE]);
    expect(() => git(r.caminho, "rev-parse", "HEAD")).toThrow(); // sem commits
  });
  it("recusa pasta existente e não vazia (nada sobrescrito) com sugestão", async () => {
    mkdirSync(join(pai, "meu-app"));
    writeFileSync(join(pai, "meu-app", "dado.txt"), "importante");
    const erro = await criarNovoProjeto(base()).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroAdicionarNucleo);
    expect((erro as ErroAdicionarNucleo).codigo).toBe("colisao");
    expect((erro as ErroAdicionarNucleo).sugestao).toBe("meu-app-2");
    expect(readFileSync(join(pai, "meu-app", "dado.txt"), "utf8")).toBe("importante");
  });
  it("aceita pasta existente VAZIA e não a apaga se algo falhar", async () => {
    mkdirSync(join(pai, "meu-app"));
    const r = await criarNovoProjeto(base());
    expect(existsSync(join(r.caminho, "README.md"))).toBe(true);
  });
  it("nome com travessia nunca cria nada fora do pai", async () => {
    for (const nome of ["../fora", "a/b", "..", "x\\y"]) {
      await expect(criarNovoProjeto(base({ nome }))).rejects.toBeInstanceOf(ErroAdicionarNucleo);
    }
    expect(readdirSync(raiz).sort()).toEqual(["projetos"]);
    expect(readdirSync(pai)).toEqual([]);
  });
  it("falha no git desfaz a pasta criada por nós", async () => {
    const erro = await criarNovoProjeto(base({ executavelGit: join(raiz, "git-que-nao-existe") })).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroAdicionarNucleo);
    expect(existsSync(join(pai, "meu-app"))).toBe(false);
  });
  it("não executa nada do template: não há hooks, scripts nem dependências", async () => {
    const r = await criarNovoProjeto(base({ template: "node" }));
    expect(readdirSync(join(r.caminho, ".git", "hooks")).filter((h) => !h.endsWith(".sample"))).toEqual([]);
    expect(existsSync(join(r.caminho, "node_modules"))).toBe(false);
  });
});
