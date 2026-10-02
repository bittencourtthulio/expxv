import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirApp } from "./fixture";
import type { AppAberto } from "./fixture";

// T-06.39 · E2E do versionamento no Electron real, com repositório git real e remoto `file://` local (nada de rede):
// editar → stage por hunk → commit → branch → merge com conflito real resolvido por hunk → fetch/pull/push.
// Zero diálogos nativos (o teste instrumenta `dialog` no main e exige contagem 0). Precisa de `npm run build` antes.
// `gh` e SVN: o remoto é file://, então o forge fica degradado (verificado); os stubs de `gh`/`svn` vivem nos testes de unidade
// (src/nucleo/forge, src/nucleo/vcs/svn, src/main/vcs.test.ts).

let a: AppAberto;
let pai: string;
let raiz: string;
let bare: string;
let ws: string;

const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env });

beforeAll(async () => {
  pai = mkdtempSync(join(tmpdir(), "ade-vcs-e2e-"));
  raiz = join(pai, "projeto");
  bare = join(pai, "origem.git");
  mkdirSync(raiz, { recursive: true });
  git(raiz, "init", "-q", "-b", "main");
  git(raiz, "config", "commit.gpgsign", "false");
  writeFileSync(join(raiz, "lista.txt"), Array.from({ length: 40 }, (_, i) => `linha ${i + 1}`).join("\n") + "\n");
  writeFileSync(join(raiz, "conflito.txt"), "base\n");
  git(raiz, "add", "-A");
  git(raiz, "commit", "-q", "-m", "inicial");
  git(pai, "init", "-q", "--bare", "-b", "main", bare);
  git(raiz, "remote", "add", "origin", `file://${bare}`);
  a = await abrirApp();
  await a.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15000 });
  // nenhum diálogo nativo pode abrir durante o fluxo
  await a.app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { __dialogos: number };
    g.__dialogos = 0;
    for (const k of ["showMessageBox", "showMessageBoxSync", "showOpenDialog", "showOpenDialogSync", "showSaveDialog", "showSaveDialogSync", "showErrorBox"] as const) {
      (dialog as unknown as Record<string, unknown>)[k] = () => { g.__dialogos++; throw new Error("diálogo nativo proibido no e2e"); };
    }
  });
  const w = await a.pagina.evaluate((c) => window.ade!.workspaces.abrir(c), raiz);
  ws = (w as { id: string }).id;
});

afterAll(async () => {
  await a.fechar();
  rmSync(pai, { recursive: true, force: true });
});

const alvo = () => ({ workspace_id: ws, mission_id: null });

describe("versionamento no Electron real", () => {
  it("edita, estagia só UM hunk, comita e confere no git de verdade", async () => {
    const lista = readFileSync(join(raiz, "lista.txt"), "utf8").split("\n");
    lista[1] = "linha 2 EDITADA";
    lista[37] = "linha 38 EDITADA";
    writeFileSync(join(raiz, "lista.txt"), lista.join("\n"));
    const r = await a.pagina.evaluate(async (al) => {
      const v = window.ade!.vcs;
      const antes = await v.estado(al, false);
      await v.estagio(al, "hunk", { caminho: "lista.txt", hunk: 0, linhas: null, sentido: "estagiar" });
      const c = await v.commit(al, "criar", { mensagem: "feat: primeiro hunk", amend: false, pular_hooks: false, coautores: [] });
      return { tipo: antes.tipo, sujoAntes: antes.resumo.sujo, hash: c.hashCurto };
    }, alvo());
    expect(r).toMatchObject({ tipo: "git", sujoAntes: true });
    expect(git(raiz, "log", "-1", "--format=%s").trim()).toBe("feat: primeiro hunk");
    expect(git(raiz, "show", "--stat", "--format=", "HEAD")).toContain("lista.txt");
    expect(git(raiz, "diff", "--numstat")).toMatch(/1\t1\tlista\.txt/); // o segundo hunk continua só no diretório de trabalho
    git(raiz, "checkout", "-q", "--", "lista.txt");
  });

  it("branch, merge com conflito real e resolução por hunk pela API da UI", async () => {
    await a.pagina.evaluate(async (al) => {
      await window.ade!.vcs.ramos(al, "criar", { nome: "feature/a", de: null, trocar: true });
    }, alvo());
    writeFileSync(join(raiz, "conflito.txt"), "da feature\n");
    git(raiz, "commit", "-q", "-am", "feature mexe no conflito");
    await a.pagina.evaluate(async (al) => { await window.ade!.vcs.ramos(al, "trocar", { destino: "main", estrategia: null }); }, alvo());
    writeFileSync(join(raiz, "conflito.txt"), "da main\n");
    git(raiz, "commit", "-q", "-am", "main mexe no conflito");
    const res = await a.pagina.evaluate(async (al) => {
      const v = window.ade!.vcs;
      const m = await v.operacao(al, "mesclar", { rev: "feature/a", sem_ff: true, squash: false, mensagem: null, simular: false });
      const lista = await v.conflitos(al, "listar", {});
      const r = await v.conflitos(al, "resolver_hunks", { caminho: "conflito.txt", resolucoes: { "0": "deles" }, marcar: true });
      const fim = await v.operacao(al, "continuar", {});
      return { merge: m.resultado, conflitos: lista.map((c) => c.caminho), restantes: r.restantes, fim: fim.resultado };
    }, alvo());
    expect(res.merge).toBe("conflito");
    expect(res.conflitos).toEqual(["conflito.txt"]);
    expect(res.restantes).toBe(0);
    expect(res.fim).toBe("ok");
    expect(readFileSync(join(raiz, "conflito.txt"), "utf8")).toBe("da feature\n");
    expect(git(raiz, "log", "-1", "--format=%P").trim().split(" ")).toHaveLength(2); // commit de merge
  });

  it("push (define upstream), fetch e pull contra o remoto file:// local; nenhum push forçado", async () => {
    const r = await a.pagina.evaluate(async (al) => {
      const v = window.ade!.vcs;
      const p = await v.remoto(al, "push", { remoto: null, ramo: "main" });
      return { enviado: p.atualizado, upstream: p.upstreamDefinido };
    }, alvo());
    expect(r).toEqual({ enviado: true, upstream: true });
    expect(git(bare, "rev-parse", "main").trim()).toBe(git(raiz, "rev-parse", "HEAD").trim());
    // outra pessoa publica um commit no remoto
    const outro = join(pai, "outro");
    git(pai, "clone", "-q", `file://${bare}`, outro);
    writeFileSync(join(outro, "de-outro.txt"), "oi\n");
    git(outro, "add", "-A");
    git(outro, "commit", "-q", "-m", "do outro");
    git(outro, "push", "-q", "origin", "main");
    const dep = await a.pagina.evaluate(async (al) => {
      const v = window.ade!.vcs;
      const f = await v.remoto(al, "fetch", { remoto: null, todos: false, podar: false });
      const simulado = await v.remoto(al, "pull", { modo: null, remoto: null, ramo: null, simular: true });
      const pl = await v.remoto(al, "pull", { modo: null, remoto: null, ramo: null, simular: false });
      const forge = await v.forge(al, "estado", {});
      return { atualizacoes: f.atualizacoes, entrariam: simulado.entrariam?.length ?? 0, pull: pl.resultado, forge: forge.forge };
    }, alvo());
    expect(dep.atualizacoes).toBeGreaterThan(0);
    expect(dep.entrariam).toBe(1);
    expect(dep.pull).not.toBe("conflito");
    expect(existsSync(join(raiz, "de-outro.txt"))).toBe(true);
    expect(dep.forge).toBeNull(); // remoto file://: sem provedor, o app segue só com git
  });

  it("a tela de Versionamento abre e mostra o branch; toda escrita ficou auditada; zero diálogos nativos", async () => {
    await a.pagina.click('nav[aria-label="Principal"] >> text=Versionamento');
    await a.pagina.waitForSelector('[role="toolbar"][aria-label="Controles do versionamento"]', { timeout: 15000 });
    expect(await a.pagina.textContent('[role="toolbar"][aria-label="Controles do versionamento"]')).toContain("main");
    const dialogos = await a.app.evaluate(() => (globalThis as unknown as { __dialogos: number }).__dialogos);
    expect(dialogos).toBe(0);
  });
});
