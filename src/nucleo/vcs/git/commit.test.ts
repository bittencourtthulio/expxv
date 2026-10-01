import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { avisosDaMensagem, CommitFalhouErro, CommitRecusadoErro, criarCommit, modeloMensagem, ultimoCommitPublicado } from "./commit";
import { escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta, scriptExecutavel } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-cm-");
  repo = initRepo(join(raiz, "r"));
});
afterEach(() => removerPasta(raiz));

function remotoPublicado(): void {
  const bare = join(raiz, "remoto.git");
  git(raiz, "init", "-q", "--bare", "-b", "main", bare);
  git(repo, "remote", "add", "origin", `file://${bare}`);
  git(repo, "push", "-q", "-u", "origin", "main");
}

function mudar(nome = "m.txt", conteudo = "m\n"): void {
  escrever(repo, nome, conteudo);
  git(repo, "add", "-A");
}

describe("criar commit", () => {
  it("cria o commit com a mensagem multi-linha (por stdin) e devolve hash", async () => {
    git(repo, "switch", "-q", "-c", "trabalho");
    mudar();
    const msg = "feat: algo novo\n\ncorpo com 'aspas' e \"duplas\" e --opcao-falsa\n$(echo x)";
    const r = await criarCommit(repo, { mensagem: msg, origem: "usuario" });
    expect(r).toMatchObject({ amend: false, hooksPulados: false, assunto: "feat: algo novo" });
    expect(git(repo, "log", "-1", "--format=%B").trim()).toBe(msg);
    expect(git(repo, "rev-parse", "HEAD").trim()).toBe(r.hash);
  });

  it("mensagem enorme não vai em argv e dá certo", async () => {
    mudar();
    const msg = "assunto\n\n" + "linha longa de corpo\n".repeat(20_000);
    await criarCommit(repo, { mensagem: msg, origem: "usuario" });
    expect(git(repo, "log", "-1", "--format=%B").length).toBeGreaterThan(300_000);
  });

  it("avisos: assunto > 72 colunas e conventional configurável (aviso x exigência)", async () => {
    expect(avisosDaMensagem("x".repeat(73))).toHaveLength(1);
    expect(avisosDaMensagem("feat(ui)!: ok\n\ncorpo")).toEqual([]);
    expect(avisosDaMensagem("qualquer coisa", "avisar")).toHaveLength(1);
    mudar();
    await expect(criarCommit(repo, { mensagem: "qualquer coisa", origem: "usuario", conventional: true })).rejects.toMatchObject({ motivo: "conventional" });
    expect(git(repo, "status", "--porcelain")).toContain("A  m.txt");
    const r = await criarCommit(repo, { mensagem: "y".repeat(80), origem: "usuario" });
    expect(r.avisos[0]).toMatch(/80 colunas/);
  });

  it("mensagem vazia e nada no índice são recusados com erro nominal", async () => {
    mudar();
    await expect(criarCommit(repo, { mensagem: "  \n", origem: "usuario" })).rejects.toBeInstanceOf(CommitRecusadoErro);
    git(repo, "commit", "-q", "-m", "x");
    const e = await criarCommit(repo, { mensagem: "nada", origem: "usuario" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CommitFalhouErro);
    expect(e).toMatchObject({ causa: "sem-mudancas", mensagem: "nada" });
  });

  it("modelo do repositório (commit.template) é lido", async () => {
    expect(await modeloMensagem(repo)).toBeNull();
    escrever(repo, ".gitmessage", "tipo: \n\n# comentário\n");
    git(repo, "config", "commit.template", ".gitmessage");
    expect(await modeloMensagem(repo)).toBe("tipo: \n\n# comentário\n");
  });

  it("trailer de coautoria configurável; coautor inválido é recusado (sem injeção de linha)", async () => {
    mudar();
    await criarCommit(repo, { mensagem: "feat: junto", origem: "usuario", coautores: ["Ana Dev <ana@example.invalid>"] });
    expect(git(repo, "log", "-1", "--format=%B")).toContain("\nCo-authored-by: Ana Dev <ana@example.invalid>");
    mudar("n.txt");
    await expect(criarCommit(repo, { mensagem: "x", origem: "usuario", coautores: ["Mau <a@b.c>\nSigned-off-by: x"] })).rejects.toMatchObject({ motivo: "trailer-invalido" });
    await expect(criarCommit(repo, { mensagem: "x", origem: "usuario", coautores: ["sem email"] })).rejects.toMatchObject({ motivo: "trailer-invalido" });
  });
});

describe("guarda da automação (D-33)", () => {
  it("automação é recusada na branch padrão (main/master/init.defaultBranch/origin/HEAD)", async () => {
    mudar();
    const e = await criarCommit(repo, { mensagem: "chore: auto", origem: "automacao" }).catch((x: unknown) => x);
    expect(e).toMatchObject({ name: "CommitRecusadoErro", motivo: "automacao-ramo-padrao" });
    expect(git(repo, "log", "--oneline")).not.toContain("auto");
    git(repo, "switch", "-q", "-c", "trunk");
    git(repo, "config", "init.defaultBranch", "trunk");
    await expect(criarCommit(repo, { mensagem: "chore: auto", origem: "automacao" })).rejects.toMatchObject({ motivo: "automacao-ramo-padrao" });
    git(repo, "switch", "-q", "-c", "master");
    await expect(criarCommit(repo, { mensagem: "chore: auto", origem: "automacao" })).rejects.toMatchObject({ motivo: "automacao-ramo-padrao" });
  });

  it("automação em branch de trabalho comita; o usuário comita na padrão", async () => {
    mudar();
    const u = await criarCommit(repo, { mensagem: "feat: usuario em main", origem: "usuario" });
    expect(u.hash).toBeTruthy();
    git(repo, "switch", "-q", "-c", "automacao/tarefa-1");
    mudar("auto.txt");
    const a = await criarCommit(repo, { mensagem: "feat: da automação", origem: "automacao" });
    expect(a.assunto).toBe("feat: da automação");
  });

  it("automação com HEAD destacado é recusada", async () => {
    mudar();
    git(repo, "switch", "-q", "--detach");
    await expect(criarCommit(repo, { mensagem: "x", origem: "automacao" })).rejects.toMatchObject({ motivo: "automacao-sem-ramo" });
  });

  it("origem desconhecida é recusada", async () => {
    mudar();
    await expect(criarCommit(repo, { mensagem: "x", origem: "outra" as never })).rejects.toBeInstanceOf(CommitRecusadoErro);
  });
});

describe("amend", () => {
  it("emenda commit local; recusa se já está no upstream/remoto", async () => {
    git(repo, "switch", "-q", "-c", "w");
    mudar();
    git(repo, "commit", "-q", "-m", "local");
    const r = await criarCommit(repo, { mensagem: "feat: local emendado", origem: "usuario", amend: true });
    expect(r.amend).toBe(true);
    expect(git(repo, "log", "-1", "--format=%s").trim()).toBe("feat: local emendado");
    expect(git(repo, "rev-list", "--count", "HEAD").trim()).toBe("2");

    git(repo, "switch", "-q", "main");
    remotoPublicado();
    mudar("p.txt");
    git(repo, "commit", "-q", "-m", "vai ser publicado");
    git(repo, "push", "-q");
    const antes = git(repo, "rev-parse", "HEAD").trim();
    const pub = await ultimoCommitPublicado(repo);
    expect(pub).toMatchObject({ publicado: true });
    const e = await criarCommit(repo, { mensagem: "reescrever", origem: "usuario", amend: true }).catch((x: unknown) => x);
    expect(e).toMatchObject({ name: "CommitRecusadoErro", motivo: "amend-publicado" });
    expect(git(repo, "rev-parse", "HEAD").trim()).toBe(antes);
  });

  it("publicado em OUTRA branch remota (sem upstream) também é recusado; sem commits é recusado", async () => {
    remotoPublicado();
    git(repo, "switch", "-q", "-c", "sem-upstream");
    await expect(criarCommit(repo, { origem: "usuario", amend: true })).rejects.toMatchObject({ motivo: "amend-publicado" });
    const vazio = initRepo(join(raiz, "v"), false);
    await expect(criarCommit(vazio, { origem: "usuario", amend: true })).rejects.toMatchObject({ motivo: "amend-sem-commit" });
  });

  it("amend sem mensagem mantém a anterior", async () => {
    git(repo, "switch", "-q", "-c", "w2");
    mudar();
    git(repo, "commit", "-q", "-m", "mensagem original");
    mudar("outro.txt");
    await criarCommit(repo, { origem: "usuario", amend: true });
    expect(git(repo, "log", "-1", "--format=%s").trim()).toBe("mensagem original");
    expect(git(repo, "show", "--name-only", "--format=").trim().split("\n").sort()).toEqual(["m.txt", "outro.txt"]);
  });
});

describe("hooks e assinatura", () => {
  it("hook que falha: saída em streaming, erro devolve a saída e PRESERVA a mensagem", async () => {
    scriptExecutavel(join(repo, ".git/hooks/pre-commit"), 'echo "lint: 3 problemas" >&2\necho "saida padrao do hook"\nexit 1');
    mudar();
    const pedacos: string[] = [];
    const msg = "feat: não pode se perder\n\ncorpo grande";
    const e = await criarCommit(repo, { mensagem: msg, origem: "usuario", aoSaida: (t) => void pedacos.push(t) }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CommitFalhouErro);
    const f = e as CommitFalhouErro;
    expect(f.mensagem).toBe(msg);
    expect(f.causa).toBe("falhou");
    expect(f.saida).toContain("lint: 3 problemas");
    expect(pedacos.join("")).toContain("lint: 3 problemas");
    expect(git(repo, "log", "--oneline").trim().split("\n")).toHaveLength(1);
    expect(git(repo, "status", "--porcelain")).toContain("A  m.txt"); // índice intacto
  });

  it("hook de commit-msg que rejeita também preserva a mensagem", async () => {
    scriptExecutavel(join(repo, ".git/hooks/commit-msg"), 'echo "mensagem fora do padrão" >&2\nexit 1');
    mudar();
    const e = (await criarCommit(repo, { mensagem: "ruim", origem: "usuario" }).catch((x: unknown) => x)) as CommitFalhouErro;
    expect(e.mensagem).toBe("ruim");
    expect(e.saida).toContain("fora do padrão");
  });

  it("--no-verify só com pularHooks:true explícito, e fica registrado", async () => {
    const marca = join(raiz, "hook-rodou");
    scriptExecutavel(join(repo, ".git/hooks/pre-commit"), `touch '${marca}'\nexit 1`);
    mudar();
    await expect(criarCommit(repo, { mensagem: "a", origem: "usuario", pularHooks: "sim" as never })).rejects.toBeInstanceOf(CommitFalhouErro);
    expect(existsSync(marca)).toBe(true);
    const r = await criarCommit(repo, { mensagem: "a", origem: "usuario", pularHooks: true });
    expect(r.hooksPulados).toBe(true);
  });

  it("assinatura herdada: commit.gpgsign=true chama o programa do usuário; se falha, não desativa a assinatura", async () => {
    const marca = join(raiz, "gpg-chamado");
    const gpg = scriptExecutavel(join(raiz, "gpg-falso"), `echo "$@" > '${marca}'\ncat > /dev/null\nexit 1`);
    git(repo, "config", "gpg.program", gpg);
    git(repo, "config", "commit.gpgsign", "true");
    mudar();
    const e = (await criarCommit(repo, { mensagem: "assinado", origem: "usuario" }).catch((x: unknown) => x)) as CommitFalhouErro;
    expect(e).toBeInstanceOf(CommitFalhouErro);
    expect(existsSync(marca)).toBe(true);
    expect(readFileSync(marca, "utf8")).toContain("-bsau");
    expect(e.mensagem).toBe("assinado");
    expect(git(repo, "log", "--oneline").trim().split("\n")).toHaveLength(1); // não criou commit sem assinatura
  });
});
