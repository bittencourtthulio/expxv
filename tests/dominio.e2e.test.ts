import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirApp } from "./fixture";
import type { AppAberto } from "./fixture";
import { gerarProjetoExpx } from "./fixtures/metodo/gerar";

// E2E do domínio no Electron real: abrir projeto (git), método lendo docs/ por IPC, Missão com worktree
// e o método reagindo a uma mudança de arquivo (≤ 600 ms após o debounce). Só toca em pastas temporárias.

let a: AppAberto;
let raiz: string;
let pai: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: raiz, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
}

beforeAll(async () => {
  pai = mkdtempSync(join(tmpdir(), "ade-dom-"));
  raiz = join(pai, "projeto");
  execFileSync("mkdir", ["-p", raiz]);
  git("init", "-q", "-b", "main");
  writeFileSync(join(raiz, "README.md"), "# projeto\n");
  gerarProjetoExpx(raiz);
  git("add", "-A");
  git("commit", "-q", "-m", "inicial");
  a = await abrirApp();
  await a.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15000 });
});

afterAll(async () => {
  await a.fechar();
  rmSync(pai, { recursive: true, force: true });
});

describe("domínio no Electron real", () => {
  it("abre o projeto, detecta git e lembra como workspace atual", async () => {
    const ws = await a.pagina.evaluate((caminho) => window.ade!.workspaces.abrir(caminho), raiz);
    expect(ws).not.toBeNull();
    expect(ws?.e_git).toBe(true);
    expect(ws?.permissao).toBe("seguro");
    const estado = await a.pagina.evaluate(() => window.ade!.workspaces.estado());
    expect(estado.atual?.id).toBe(ws?.id);
    expect(estado.recentes.length).toBeGreaterThanOrEqual(1);
  });

  it("recusa caminho relativo ou inexistente com erro nominal", async () => {
    const erro = await a.pagina.evaluate(async () => {
      try {
        await window.ade!.workspaces.abrir("relativo/qualquer");
        return null;
      } catch (e) {
        return String((e as Error).message);
      }
    });
    expect(erro).not.toBeNull();
  });

  it("o método lê docs/ do projeto aberto (fixture Expx) sem travar", async () => {
    const wsId = (await a.pagina.evaluate(() => window.ade!.workspaces.estado())).atual!.id;
    let trabalhos = 0;
    const limite = Date.now() + 8000;
    while (Date.now() < limite && trabalhos === 0) {
      const indice = await a.pagina.evaluate((id) => window.ade!.metodo.estado(id), wsId);
      trabalhos = indice?.trabalhos.length ?? 0;
      if (trabalhos === 0) await a.pagina.waitForTimeout(200);
    }
    expect(trabalhos).toBeGreaterThan(3);
  });

  it("mudança em arquivo de docs/ chega ao renderer como evento do método", async () => {
    const wsId = (await a.pagina.evaluate(() => window.ade!.workspaces.estado())).atual!.id;
    await a.pagina.evaluate(() => {
      (window as unknown as { __mudancas: number }).__mudancas = 0;
      window.ade!.metodo.assinar(() => {
        (window as unknown as { __mudancas: number }).__mudancas += 1;
      });
    });
    const alvo = join(raiz, "docs", "sprintx", "features", "cobranca-pix", "00-BLOQUEIOS.md");
    expect(existsSync(alvo)).toBe(true);
    writeFileSync(alvo, readFileSync(alvo, "utf8") + "\n<!-- toque -->\n");
    const t0 = Date.now();
    await a.pagina.waitForFunction(() => (window as unknown as { __mudancas: number }).__mudancas > 0, undefined, { timeout: 5000 });
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(2500); // folga do e2e; o orçamento P-11 (600 ms) é medido nos testes do observador
    expect(typeof wsId).toBe("string");
  });

  it("cria Missão de feature: worktree e branch certos, sem apagar nada ao abortar", async () => {
    const wsId = (await a.pagina.evaluate(() => window.ade!.workspaces.estado())).atual!.id;
    const missao = await a.pagina.evaluate(
      (id) => window.ade!.missoes.criar({ workspace_id: id, modo: "livre", origem: "feature", titulo: "Agenda online", pedido: "agenda online", clis: {} }),
      wsId,
    );
    expect(missao.origem).toBe("feature");
    expect(missao.branch).toBe("feature/agenda-online");
    expect(missao.worktree).not.toBeNull();
    const worktreeAbs = join(pai, "projeto--agenda-online");
    expect(existsSync(worktreeAbs)).toBe(true);
    const lista = git("worktree", "list", "--porcelain");
    expect(lista).toContain("projeto--agenda-online");

    const abortada = await a.pagina.evaluate((id) => window.ade!.missoes.abortar(id), missao.id);
    expect(abortada?.estado).toBe("abortada");
    expect(existsSync(worktreeAbs)).toBe(true); // abortar NUNCA apaga o worktree
  });
});
