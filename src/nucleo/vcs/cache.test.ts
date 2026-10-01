import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { criarGerenciadorVcs, type GerenciadorVcs } from "./cache";
import { commit, escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../tests/fixtures/vcs/repos";
import type { StatusRepo } from "./vcs";

let raiz: string;
let ger: GerenciadorVcs;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-cache-");
});
afterEach(async () => {
  await ger?.fechar();
  removerPasta(raiz);
});

async function ate(cond: () => boolean, ms = 6000): Promise<boolean> {
  const fim = Date.now() + ms;
  while (Date.now() < fim && !cond()) await new Promise((r) => setTimeout(r, 25));
  return cond();
}

describe("cache de estado VCS", () => {
  it("primeiro `atual()` é 'calculando' sem esperar; depois do pronto vem o status real", async () => {
    const repo = initRepo(join(raiz, "r"));
    escrever(repo, "a.txt", "mudou\n");
    ger = criarGerenciadorVcs({ debounceMs: 30 });
    const e = await ger.abrir(repo, repo);
    expect(e.atual().estado).toBe("calculando");
    const s = await e.pronto;
    expect(s.estado).toBe("pronto");
    expect(e.atual().arquivos.map((a) => a.caminho)).toEqual(["a.txt"]);
  });

  it("invalida por evento: editar arquivo atualiza o cache e avisa o ouvinte, sem polling", async () => {
    const repo = initRepo(join(raiz, "r"));
    ger = criarGerenciadorVcs({ debounceMs: 30 });
    const e = await ger.abrir(repo, repo);
    await e.pronto;
    await new Promise((r) => setTimeout(r, 300));
    const vistos: StatusRepo[] = [];
    e.aoMudar((s) => vistos.push(s));
    escrever(repo, "novo.txt", "x");
    expect(await ate(() => e.atual().arquivos.some((a) => a.caminho === "novo.txt"))).toBe(true);
    expect(vistos.length).toBeGreaterThan(0);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "c");
    expect(await ate(() => e.atual().arquivos.length === 0)).toBe(true);
  });

  it("3 worktrees do mesmo repositório têm estados independentes", async () => {
    const repo = initRepo(join(raiz, "r"));
    const w1 = join(raiz, "w1");
    const w2 = join(raiz, "w2");
    git(repo, "worktree", "add", "-q", "-b", "b1", w1);
    git(repo, "worktree", "add", "-q", "-b", "b2", w2);
    ger = criarGerenciadorVcs({ debounceMs: 30 });
    const [e0, e1, e2] = await Promise.all([ger.abrir(repo, repo), ger.abrir(repo, w1), ger.abrir(repo, w2)]);
    await Promise.all([e0.pronto, e1.pronto, e2.pronto]);
    expect(ger.tamanho()).toBe(3);
    expect([e0, e1, e2].map((e) => e.atual().branch)).toEqual(["main", "b1", "b2"]);
    await new Promise((r) => setTimeout(r, 300));
    escrever(w1, "so-no-w1.txt", "x");
    expect(await ate(() => e1.atual().arquivos.length === 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    expect(e0.atual().arquivos).toEqual([]);
    expect(e2.atual().arquivos).toEqual([]);
    escrever(w2, "a.txt", "mudou\n");
    commit(w2, "no w2");
    expect(await ate(() => e2.atual().oid !== e0.atual().oid)).toBe(true);
    expect(e1.atual().arquivos).toHaveLength(1);
    expect(e1.atual().oid).toBe(e0.atual().oid);
    expect(e2.atual().oid).not.toBe(e0.atual().oid);
  });

  it("edição de arquivo rastreado usa o status PARCIAL; arquivo novo e mudança de índice recuam para o completo", async () => {
    const repo = initRepo(join(raiz, "r"));
    escrever(repo, "b.txt", "b\n");
    commit(repo, "b");
    ger = criarGerenciadorVcs({ debounceMs: 30 });
    const e = await ger.abrir(repo, repo);
    await e.pronto;
    expect(e.atual().parcial).toBeUndefined();
    await new Promise((r) => setTimeout(r, 300));
    escrever(repo, "b.txt", "mudou\n");
    expect(await ate(() => e.atual().arquivos.some((a) => a.caminho === "b.txt"))).toBe(true);
    expect(e.atual().parcial).toBe(true);
    escrever(repo, "novo.txt", "n");
    expect(await ate(() => e.atual().arquivos.some((a) => a.caminho === "novo.txt"))).toBe(true);
    expect(e.atual().parcial).toBeUndefined(); // arquivo novo: completo
    git(repo, "add", "-A");
    expect(await ate(() => e.atual().contagens.staged === 2)).toBe(true);
    expect(e.atual().parcial).toBeUndefined();
  });

  it("abrir duas vezes o mesmo (workspace, worktree) reaproveita e conta referências; liberar solta tudo", async () => {
    const repo = initRepo(join(raiz, "r"));
    ger = criarGerenciadorVcs({ debounceMs: 30 });
    const a = await ger.abrir(repo, repo);
    const b = await ger.abrir(repo, repo);
    expect(a).toBe(b);
    expect(ger.tamanho()).toBe(1);
    await ger.liberar(a);
    expect(ger.tamanho()).toBe(1);
    await ger.liberar(b);
    expect(ger.tamanho()).toBe(0);
    expect(a.atual().arquivos).toEqual([]);
  });

  it("liberarWorkspace descarta só os estados daquele workspace", async () => {
    const r1 = initRepo(join(raiz, "r1"));
    const r2 = initRepo(join(raiz, "r2"));
    ger = criarGerenciadorVcs({ debounceMs: 30 });
    await ger.abrir(r1, r1);
    await ger.abrir(r2, r2);
    await ger.liberarWorkspace(r1);
    expect(ger.tamanho()).toBe(1);
  });

  it("eventos durante o cálculo viram UM recálculo; cálculos nunca se sobrepõem", async () => {
    const repo = initRepo(join(raiz, "r"));
    let emCurso = 0;
    let maxEmCurso = 0;
    let chamadas = 0;
    let soltar!: () => void;
    ger = criarGerenciadorVcs({
      semObservador: true,
      calcularStatus: async () => {
        chamadas++;
        emCurso++;
        maxEmCurso = Math.max(maxEmCurso, emCurso);
        if (chamadas === 1) await new Promise<void>((r) => (soltar = r));
        emCurso--;
        return { ...(await import("./git/status")).statusVazio(), branch: `v${chamadas}` };
      },
    });
    const e = await ger.abrir(repo, repo);
    await new Promise((r) => setTimeout(r, 20));
    void e.atualizar();
    void e.atualizar();
    void e.atualizar();
    soltar();
    await e.pronto;
    await ate(() => chamadas === 2 && e.atual().branch === "v2");
    expect(chamadas).toBe(2);
    expect(maxEmCurso).toBe(1);
  });

  it("pasta sem git: estado 'pronto' vazio, sem processo nem observador de git", async () => {
    ger = criarGerenciadorVcs({ debounceMs: 30 });
    const e = await ger.abrir(raiz, raiz);
    expect(e.deteccao.tipo).toBe("nenhum");
    expect((await e.pronto).estado).toBe("pronto");
  });

  it("erro de cálculo vira ultimoErro sem derrubar; o seguinte limpa", async () => {
    const repo = initRepo(join(raiz, "r"));
    let n = 0;
    ger = criarGerenciadorVcs({
      semObservador: true,
      calcularStatus: async () => {
        if (++n === 1) throw new Error("falhou");
        return (await import("./git/status")).statusVazio();
      },
    });
    const e = await ger.abrir(repo, repo);
    await e.pronto;
    expect(e.ultimoErro()?.message).toBe("falhou");
    expect(e.atual().estado).toBe("pronto");
    await e.atualizar();
    expect(e.ultimoErro()).toBeNull();
  });
});
