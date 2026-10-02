import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUTO } from "../src/nucleo/produto";
import { abrirApp } from "./fixture";
import type { AppAberto } from "./fixture";

// Commit e push / Enviar PR (D-630..D-639) no Electron real. Repositório git LOCAL com `origin` com cara de GitHub (a URL só é LIDA; o push, que o app
// nunca faz, iria para uma pasta bare local por `pushInsteadOf`). Nenhuma rede, nenhum `gh` real, nenhum push/PR. Sem CLI de IA instalada no ambiente de CI
// o envio termina em `falhou` com o motivo (e sem navegar), que é parte do contrato. Precisa de `npm run build` antes (não rodado nesta entrega).

let a: AppAberto;
let pai: string;
let raiz: string;
let ws: string;

const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env });

beforeAll(async () => {
  pai = mkdtempSync(join(tmpdir(), "ade-publicar-e2e-"));
  raiz = join(pai, "projeto");
  const bare = join(pai, "origem.git");
  mkdirSync(raiz, { recursive: true });
  git(raiz, "init", "-q", "-b", "main");
  git(raiz, "config", "commit.gpgsign", "false");
  writeFileSync(join(raiz, "README.md"), "# projeto\n");
  git(raiz, "add", "-A");
  git(raiz, "commit", "-q", "-m", "inicial");
  git(pai, "init", "-q", "--bare", "-b", "main", bare);
  git(raiz, "remote", "add", "origin", "https://github.com/dono/projeto.git");
  git(raiz, "config", `url.${bare}.pushInsteadOf`, "https://github.com/dono/projeto.git");
  git(raiz, "push", "-q", "-u", "origin", "main");
  writeFileSync(join(raiz, "novo.ts"), "export const x = 1;\n");
  writeFileSync(join(raiz, ".env"), "CHAVE=valor\n");
  a = await abrirApp();
  await a.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15000 });
  const w = await a.pagina.evaluate((c) => window.ade!.workspaces.abrir(c), raiz);
  ws = (w as { id: string }).id;
});

afterAll(async () => {
  await a.fechar();
  rmSync(pai, { recursive: true, force: true });
});

describe("commit e push / enviar PR no Electron real", () => {
  it("o estado local enxerga git, GitHub, branch padrão e a alteração (sem o segredo)", async () => {
    const e = await a.pagina.evaluate((id) => window.ade!.vcsPublicar.estado(id, false), ws);
    expect(e).toMatchObject({ git: true, remoto_github: true, repo: "dono/projeto", branch: "main", ramo_padrao: "main", no_padrao: true, alteradas: 1 });
  });

  it("os botões aparecem só na tela Terminais", async () => {
    await a.pagina.getByRole("button", { name: /Início/ }).first().click().catch(() => undefined);
    expect(await a.pagina.getByRole("group", { name: "Publicar no GitHub" }).count()).toBe(0);
    await a.pagina.getByRole("button", { name: /Terminais/ }).first().click();
    await a.pagina.getByRole("group", { name: "Publicar no GitHub" }).waitFor({ timeout: 8000 });
    expect(await a.pagina.getByRole("button", { name: /Commit e push/ }).count()).toBe(1);
  });

  it("o preparo lista só nomes e separa o segredo", async () => {
    const p = await a.pagina.evaluate((id) => window.ade!.vcsPublicar.prepararCommitPush(id, null), ws);
    expect(p.arquivos.map((x) => x.caminho)).toEqual(["novo.ts"]);
    expect(p.sensiveis).toEqual([".env"]);
    expect(p.no_padrao).toBe(true);
    expect(JSON.stringify(p)).not.toContain("CHAVE=valor");
  });

  it("no branch padrão o envio sem branch novo nem a frase digitada é recusado, e nada vai para o repositório", async () => {
    const r = await a.pagina.evaluate((id) => window.ade!.vcsPublicar.enviarInstrucao({
      workspace_id: id, tipo: "commit_push", sessao_foco: null, cli: null, modo_painel: "auto",
      opcoes: { criar_ramo: false, nome_ramo: null, incluir_nao_rastreados: true, incluir_suite: false, mensagem: { modo: "agente", texto: null }, pr: null, confirmar_padrao: null },
    }), ws);
    expect(r.estado).toBe("falhou");
    expect(r.motivo).toMatch(/push na main/);
    expect(git(raiz, "log", "--oneline").trim().split("\n")).toHaveLength(1);
  });

  it("nome de branch malicioso é recusado no IPC (validador estrito)", async () => {
    const r = await a.pagina.evaluate((id) => window.ade!.vcsPublicar.enviarInstrucao({
      workspace_id: id, tipo: "commit_push", sessao_foco: null, cli: null, modo_painel: "auto",
      opcoes: { criar_ramo: true, nome_ramo: "x; rm -rf ~", incluir_nao_rastreados: true, incluir_suite: false, mensagem: { modo: "agente", texto: null }, pr: null, confirmar_padrao: null },
    }).then(() => "aceito", (e: Error) => e.message), ws);
    expect(r).not.toBe("aceito");
  });

  it("com branch novo e sem CLI de IA instalada: falhou com o motivo, sem navegar e sem deixar instrução no disco", async () => {
    const r = await a.pagina.evaluate((id) => window.ade!.vcsPublicar.enviarInstrucao({
      workspace_id: id, tipo: "commit_push", sessao_foco: null, cli: null, modo_painel: "auto",
      opcoes: { criar_ramo: true, nome_ramo: "feat/e2e", incluir_nao_rastreados: true, incluir_suite: false, mensagem: { modo: "agente", texto: null }, pr: null, confirmar_padrao: null },
    }), ws);
    if (r.estado === "entregue") return; // ambiente com CLI de IA instalada: a entrega real aconteceu (coberta nos testes de unidade)
    expect(r.estado).toBe("falhou");
    expect(r.motivo).not.toBeNull();
    const pasta = join(raiz, PRODUTO.pastaNoProjeto, "publicar");
    expect(existsSync(pasta) ? readdirSync(pasta) : []).toEqual([]);
    expect(git(raiz, "branch", "--list", "feat/e2e").trim()).toBe(""); // o app nunca cria branch: quem cria é o agente
  });

  it("abrir URL só aceita https://github.com", async () => {
    const [ok, ruim] = await a.pagina.evaluate(async (id) => [await window.ade!.vcsPublicar.abrirUrl(id, "http://github.com/a/b").catch(() => false), await window.ade!.vcsPublicar.abrirUrl(id, "https://evil.io/x").catch(() => false)], ws);
    expect(ok).toBe(false);
    expect(ruim).toBe(false);
  });
});
