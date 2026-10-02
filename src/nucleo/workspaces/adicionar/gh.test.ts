import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ExecutorVcs } from "../../vcs/executor";
import { pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";
import { CAMPOS_REPO, estadoGh, LIMITE_REPOS, listarMeusRepositorios, parsearRepos } from "./gh";
import { ErroAdicionarNucleo } from "./erros";

const GH_FALSO = resolve(__dirname, "../../../../tests/fixtures/workspaces-adicionar/gh-falso.mjs");
let raiz: string;
let log: string;
const executor = new ExecutorVcs();
const op = () => ({ executor, cwd: raiz, executavel: GH_FALSO });
beforeEach(() => {
  raiz = pastaTmp("adic-gh-");
  log = join(raiz, "chamadas.log");
  process.env.GH_FALSO_LOG = log;
});
afterEach(() => {
  delete process.env.GH_FALSO_MODO;
  delete process.env.GH_FALSO_LOG;
  removerPasta(raiz);
});
const chamadas = (): string[][] => {
  try {
    return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]);
  } catch {
    return [];
  }
};

describe("estadoGh", () => {
  it("instalado e autenticado (só `gh --version` e `gh auth status`; nenhuma listagem)", async () => {
    expect(await estadoGh(op())).toEqual({ instalado: true, autenticado: true, usuario: "fulana" });
    expect(chamadas().map((c) => c.slice(0, 2).join(" "))).toEqual(["--version", "auth status"]);
  });
  it("instalado mas NÃO autenticado", async () => {
    process.env.GH_FALSO_MODO = "nao_autenticado";
    expect(await estadoGh(op())).toEqual({ instalado: true, autenticado: false, usuario: null });
  });
  it("gh ausente", async () => {
    expect(await estadoGh({ ...op(), executavel: join(raiz, "nao-existe") })).toEqual({ instalado: false, autenticado: false, usuario: null });
  });
});

describe("listarMeusRepositorios", () => {
  it("pede exatamente os campos combinados, com limite 100, e devolve saneado e ordenado por último push", async () => {
    const r = await listarMeusRepositorios(op());
    expect(chamadas()[0]).toEqual(["repo", "list", "--limit", "100", "--json", "name,nameWithOwner,description,isPrivate,pushedAt,url"]);
    expect(CAMPOS_REPO).toBe("name,nameWithOwner,description,isPrivate,pushedAt,url");
    expect(r.repos.map((x) => x.nome_com_dono)).toEqual(["fulana/recente", "fulana/antigo", "fulana/sem-data"]);
    expect(r.repos[0]).toMatchObject({ privado: true, url: "https://github.com/fulana/recente" });
    expect(r.repos.find((x) => x.nome === "antigo")?.descricao).toBe("primeiro  repo"); // controle vira espaço
    expect(r.repos.find((x) => x.nome === "sem-data")?.atualizado_em).toBeNull();
  });
  it("descarta item com URL fora de https ou dono começando com hífen (nunca vira argumento)", async () => {
    const r = await listarMeusRepositorios(op());
    expect(r.repos.map((x) => x.nome)).not.toContain("malicioso");
    expect(r.repos.map((x) => x.nome)).not.toContain("-oProxy");
  });
  it("não autenticado → erro acionável com ação de login", async () => {
    process.env.GH_FALSO_MODO = "nao_autenticado";
    const e = await listarMeusRepositorios(op()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroAdicionarNucleo);
    expect(e).toMatchObject({ codigo: "sem_acesso", acao: "login_gh" });
  });
  it("sem internet", async () => {
    process.env.GH_FALSO_MODO = "rede";
    await expect(listarMeusRepositorios(op())).rejects.toMatchObject({ codigo: "sem_internet" });
  });
  it("gh ausente", async () => {
    await expect(listarMeusRepositorios({ ...op(), executavel: join(raiz, "nao-existe") })).rejects.toMatchObject({ codigo: "gh_ausente" });
  });
  it("saída que não é JSON vira lista vazia, nunca exceção", async () => {
    process.env.GH_FALSO_MODO = "lixo";
    expect(await listarMeusRepositorios(op())).toEqual({ repos: [], truncado: false });
  });
  it("cancelável por AbortSignal", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(listarMeusRepositorios({ ...op(), sinal: ctl.signal })).rejects.toMatchObject({ codigo: "cancelado" });
  });
});

describe("parsearRepos", () => {
  it("limita a 100 e marca truncado quando a CLI devolveu o teto", () => {
    const itens = Array.from({ length: 150 }, (_, i) => ({ name: `r${i}`, nameWithOwner: `o/r${i}`, description: "", isPrivate: false, pushedAt: new Date(2026, 0, 1 + (i % 28)).toISOString(), url: `https://github.com/o/r${i}` }));
    const r = parsearRepos(JSON.stringify(itens));
    expect(r.repos).toHaveLength(LIMITE_REPOS);
    expect(r.truncado).toBe(true);
  });
  it("descrição longa é cortada e segredos conhecidos saem do texto", () => {
    const token = ["ghp", "_", "b".repeat(36)].join("");
    const r = parsearRepos(JSON.stringify([{ name: "x", nameWithOwner: "o/x", description: `${token} ${"a".repeat(500)}`, isPrivate: false, pushedAt: "2026-01-01T00:00:00Z", url: "https://github.com/o/x" }]));
    expect(r.repos[0]?.descricao).not.toContain(token);
    expect(r.repos[0]?.descricao.length).toBeLessThanOrEqual(300);
  });
  it("JSON inválido ou formato errado", () => {
    expect(parsearRepos("nada").repos).toEqual([]);
    expect(parsearRepos("{}").repos).toEqual([]);
  });
});
