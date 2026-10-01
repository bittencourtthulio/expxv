import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { descobrirRepo, estadoCli, parseAuthStatus, parseVersao } from "./detectar";
import { parseRemoto, provedorPorHost } from "./comum";
import { criarFake, type Fake } from "../../../tests/fixtures/forge/ajudante";
import { git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../tests/fixtures/vcs/repos";

const AUTH_TXT = readFileSync(join(__dirname, "../../../tests/fixtures/forge/gh/auth-status.txt"), "utf8");
let fake: Fake | undefined;
afterEach(() => {
  fake?.limpar();
  fake = undefined;
});
beforeAll(isolarConfigGit);

describe("parseAuthStatus (T-06.17)", () => {
  it("lê hosts, contas e a ativa; descarta qualquer token", () => {
    const contas = parseAuthStatus(AUTH_TXT);
    expect(contas).toHaveLength(3);
    expect(contas.find((c) => c.usuario === "octocat")).toMatchObject({ host: "github.com", ativa: true, protocolo: "https" });
    expect(contas.find((c) => c.usuario === "outra-conta")).toMatchObject({ ativa: false, protocolo: "ssh" });
    expect(contas.find((c) => c.host === "ghe.acme.corp")).toMatchObject({ usuario: "thulio", ativa: true });
    const json = JSON.stringify(contas);
    expect(json).not.toMatch(/SEGREDODOTESTE|gho_|ghp_/);
  });
  it("aceita `--json hosts` e saída vazia/deslogada sem lançar", () => {
    const j = JSON.stringify({ hosts: { "github.com": [{ state: "success", active: true, host: "github.com", login: "ana", gitProtocol: "ssh", token: "gho_NAOLER" }, { state: "error", active: false, host: "github.com", login: "x" }] } });
    expect(parseAuthStatus(j)).toEqual([{ host: "github.com", usuario: "ana", ativa: true, protocolo: "ssh" }]);
    expect(parseAuthStatus("You are not logged into any GitHub hosts. To log in, run: gh auth login")).toEqual([]);
    expect(parseAuthStatus("")).toEqual([]);
  });
  it("glab: 'Logged in to host as user'", () => {
    const c = parseAuthStatus("gitlab.com\n  ✓ Logged in to gitlab.com as bia (/home/x/config.yml)\n  ✓ Token found: **********\n");
    expect(c).toEqual([{ host: "gitlab.com", usuario: "bia", ativa: true }]);
  });
  it("versão", () => {
    expect(parseVersao("gh version 2.50.0 (2024-06-01)\nhttps://github.com/cli/cli")).toBe("2.50.0");
    expect(parseVersao("")).toBeNull();
  });
});

describe("estadoCli", () => {
  const repo = { host: "github.com", caminho: "acme/app" };
  it("instalada e logada: versão, conta ativa, sem degradar e sem token", async () => {
    fake = criarFake([{ quando: ["--version"], saida: "gh version 2.50.0 (2024-06-01)\n" }, { quando: ["auth", "status"], saida: AUTH_TXT }]);
    const e = await estadoCli("github", repo, fake.cwd, { executor: fake.executor, executavel: fake.gh, env: fake.env });
    expect(e).toMatchObject({ provedor: "github", autenticado: true, degradado: false, instrucao: null, cli: { instalada: true, versao: "2.50.0" } });
    expect(JSON.stringify(e)).not.toMatch(/SEGREDODOTESTE|gho_/);
    expect(fake.chamadas().every((c) => c.promptOff && c.semCor)).toBe(true);
    expect(fake.chamadas().flatMap((c) => c.argv)).not.toContain("--show-token");
  });
  it("sem a CLI: estado claro, instrução de instalação e modo degradado", async () => {
    fake = criarFake();
    const e = await estadoCli("github", repo, fake.cwd, { executor: fake.executor, executavel: join(fake.dir, "nao-existe-gh") });
    expect(e).toMatchObject({ autenticado: false, degradado: true, cli: { instalada: false, versao: null } });
    expect(e.instrucao).toMatch(/brew install gh/);
  });
  it("CLI presente mas deslogada: próximo passo é `gh auth login`", async () => {
    fake = criarFake([{ quando: ["--version"], saida: "gh version 2.50.0\n" }, { quando: ["auth", "status"], stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login\n", codigo: 1 }]);
    const e = await estadoCli("github", repo, fake.cwd, { executor: fake.executor, executavel: fake.gh, env: fake.env });
    expect(e).toMatchObject({ autenticado: false, degradado: true, cli: { instalada: true } });
    expect(e.instrucao).toMatch(/gh auth login --hostname github\.com/);
  });
  it("múltiplas contas: só vale a ATIVA do host do remoto", async () => {
    const so_inativa = "github.com\n  ✓ Logged in to github.com account velha (keyring)\n  - Active account: false\n";
    fake = criarFake([{ quando: ["--version"], saida: "gh version 2.50.0\n" }, { quando: ["auth", "status"], saida: so_inativa }]);
    const e = await estadoCli("github", repo, fake.cwd, { executor: fake.executor, executavel: fake.gh, env: fake.env });
    expect(e.autenticado).toBe(false);
    fake.definir([{ quando: ["--version"], saida: "gh version 2.50.0\n" }, { quando: ["auth", "status"], saida: AUTH_TXT }]);
    expect((await estadoCli("github", { host: "ghe.acme.corp", caminho: "x/y" }, fake.cwd, { executor: fake.executor, executavel: fake.gh, env: fake.env })).autenticado).toBe(true);
  });
});

describe("remoto → owner/repo", () => {
  it("https (credencial descartada), scp, ssh://, GitLab com subgrupos, Azure", () => {
    expect(parseRemoto("https://ghp_TOKEN123@github.com/acme/app.git")).toEqual({ host: "github.com", caminho: "acme/app" });
    expect(parseRemoto("https://user:senha@github.com/acme/app")).toEqual({ host: "github.com", caminho: "acme/app" });
    expect(parseRemoto("git@github.com:acme/app.git")).toEqual({ host: "github.com", caminho: "acme/app" });
    expect(parseRemoto("ssh://git@ghe.acme.corp:2222/acme/app.git")).toEqual({ host: "ghe.acme.corp", caminho: "acme/app" });
    expect(parseRemoto("https://gitlab.com/grupo/sub/proj.git")).toEqual({ host: "gitlab.com", caminho: "grupo/sub/proj" });
    expect(parseRemoto("https://dev.azure.com/org/proj/_git/repo")).toEqual({ host: "dev.azure.com", caminho: "org/proj/repo" });
    expect(parseRemoto("git@ssh.dev.azure.com:v3/org/proj/repo")).toEqual({ host: "dev.azure.com", caminho: "org/proj/repo" });
    expect(parseRemoto("/caminho/local/repo.git")).toBeNull();
    expect(parseRemoto("file:///tmp/x.git")).toBeNull();
  });
  it("provedor por hostname, com Enterprise/self-hosted configurados", () => {
    expect(provedorPorHost("github.com")).toBe("github");
    expect(provedorPorHost("gitlab.com")).toBe("gitlab");
    expect(provedorPorHost("bitbucket.org")).toBe("bitbucket");
    expect(provedorPorHost("dev.azure.com")).toBe("azure");
    expect(provedorPorHost("git.interno.corp")).toBeNull();
    expect(provedorPorHost("git.interno.corp", { gitlab: ["git.interno.corp"] })).toBe("gitlab");
  });
  it("descobrirRepo lê o remoto do repositório (origin) e nunca devolve credencial", async () => {
    const raiz = pastaTmp("forge-det-");
    try {
      const r = initRepo(join(raiz, "r"));
      git(r, "remote", "add", "origin", "https://ghp_SEGREDO@github.com/acme/app.git");
      const d = await descobrirRepo(r);
      expect(d).toEqual({ provedor: "github", repo: { host: "github.com", caminho: "acme/app" }, remoto: "origin" });
      expect(JSON.stringify(d)).not.toContain("SEGREDO");
      git(r, "remote", "set-url", "origin", "git@ghe.acme.corp:acme/app.git");
      expect((await descobrirRepo(r, { hostsExtras: { github: ["ghe.acme.corp"] } })).provedor).toBe("github");
      const vazio = initRepo(join(raiz, "v"));
      expect(await descobrirRepo(vazio)).toEqual({ provedor: null, repo: null, remoto: null });
    } finally {
      removerPasta(raiz);
    }
  });
});

// Integração local OPCIONAL: leitura real de `gh auth status` (só leitura). Pula sem `gh`.
function temGh(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
describe.skipIf(!temGh())("integração local (gh real, só leitura)", () => {
  it("estadoCli devolve forma válida e nunca expõe token", async () => {
    const e = await estadoCli("github", { host: "github.com", caminho: "acme/app" }, process.cwd());
    expect(e.cli.instalada).toBe(true);
    expect(e.cli.versao).toMatch(/\d+\.\d+/);
    expect(JSON.stringify(e)).not.toMatch(/gh[pousr]_[A-Za-z0-9]{16,}/);
  });
});
