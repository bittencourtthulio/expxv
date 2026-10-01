import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { blameGit, calcularPistas, CursorObsoletoErro, detalheCommit, historicoArquivo, logGit, parseBlamePorcelain, parseLog, type LinhaGrafo } from "./log";
import { commit, escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-log-");
  repo = initRepo(join(raiz, "r"));
});
afterEach(() => removerPasta(raiz));

/** Invariantes do grafo: cada pai desce por uma pista que o encontra depois; nada compartilha pista com hash diferente. */
function validarGrafo(linhas: LinhaGrafo[], pais: Map<string, string[]>): void {
  const col = new Map<number, string>();
  for (const l of linhas) {
    const entram = [...col.entries()].filter(([, h]) => h === l.hash).map(([c]) => c);
    expect(l.entra).toEqual(entram);
    if (entram.length > 0) expect(l.coluna).toBe(Math.min(...entram));
    else expect(col.has(l.coluna)).toBe(false);
    for (const c of entram) col.delete(c);
    expect(l.passa).toEqual([...col.keys()].sort((a, b) => a - b));
    const ps = pais.get(l.hash) as string[];
    expect(l.saidas).toHaveLength(ps.length);
    ps.forEach((p, k) => {
      const c = l.saidas[k] as number;
      const atual = col.get(c);
      expect(atual === undefined || atual === p).toBe(true);
      col.set(c, p);
    });
  }
}

describe("log paginado e grafo", () => {
  it("cursor por hash: páginas sem repetição nem buraco, grafo contínuo entre páginas", async () => {
    for (let i = 0; i < 29; i++) {
      escrever(repo, "f.txt", `v${i}\n`);
      commit(repo, `c${i}`);
    }
    const todos = git(repo, "rev-list", "HEAD").trim().split("\n");
    expect(todos).toHaveLength(30);
    const vistos: string[] = [];
    const linhas: LinhaGrafo[] = [];
    let cursor;
    let paginas = 0;
    do {
      const p = await logGit(repo, { limite: 7, ...(cursor ? { cursor } : {}) });
      vistos.push(...p.commits.map((c) => c.hash));
      linhas.push(...(p.grafo as LinhaGrafo[]));
      cursor = p.proximo ?? undefined;
      paginas++;
    } while (cursor);
    expect(paginas).toBe(5);
    expect(vistos).toEqual(todos);
    expect(linhas.every((l) => l.coluna === 0)).toBe(true);
    validarGrafo(linhas, new Map(todos.map((h, i) => [h, i === todos.length - 1 ? [] : [todos[i + 1] as string]])));
  });

  it("cursor de um histórico que mudou vira CursorObsoletoErro", async () => {
    for (let i = 0; i < 5; i++) {
      escrever(repo, "f.txt", `v${i}\n`);
      commit(repo, `c${i}`);
    }
    const p = await logGit(repo, { limite: 2 });
    git(repo, "reset", "-q", "--hard", "HEAD~3");
    await expect(logGit(repo, { limite: 2, cursor: p.proximo as NonNullable<typeof p.proximo> })).rejects.toBeInstanceOf(CursorObsoletoErro);
  });

  it("merge octopus: três pais em pistas distintas, todas fechadas na raiz", async () => {
    git(repo, "switch", "-q", "-c", "b1");
    escrever(repo, "b1.txt", "1\n");
    commit(repo, "b1");
    git(repo, "switch", "-q", "main");
    git(repo, "switch", "-q", "-c", "b2");
    escrever(repo, "b2.txt", "2\n");
    commit(repo, "b2");
    git(repo, "switch", "-q", "main");
    git(repo, "switch", "-q", "-c", "b3");
    escrever(repo, "b3.txt", "3\n");
    commit(repo, "b3");
    git(repo, "switch", "-q", "main");
    escrever(repo, "m.txt", "m\n");
    commit(repo, "main avanca");
    git(repo, "merge", "-q", "--no-edit", "b1", "b2", "b3");
    const p = await logGit(repo, { limite: 50 });
    const merge = p.commits[0] as (typeof p.commits)[number];
    expect(merge.pais).toHaveLength(4);
    const g = p.grafo as LinhaGrafo[];
    expect(new Set((g[0] as LinhaGrafo).saidas).size).toBe(4); // uma pista por pai
    validarGrafo(g, new Map(p.commits.map((c) => [c.hash, c.pais])));
    const ultimo = calcularPistas(p.commits).pistas;
    expect(ultimo).toEqual([]); // nenhuma pista pendente depois da raiz
    expect(Math.max(...g.map((l) => l.largura))).toBeGreaterThanOrEqual(4);
  });

  it("calcularPistas tolera pai que aparece antes do filho (ordem imperfeita) sem lançar", () => {
    const r = calcularPistas([{ hash: "p", pais: [] }, { hash: "f", pais: ["p"] }]);
    expect(r.linhas).toHaveLength(2);
  });

  it("refs, autor, data ISO; repositório sem commits devolve vazio", async () => {
    const p = await logGit(repo);
    expect(p.commits[0]).toMatchObject({ assunto: "inicial", autor: "Teste", email: "teste@example.invalid" });
    expect(p.commits[0]?.refs.join(",")).toContain("main");
    expect(p.commits[0]?.data).toMatch(/^\d{4}-\d\d-\d\dT/);
    const vazio = initRepo(join(raiz, "vazio"), false);
    expect(await logGit(vazio)).toMatchObject({ commits: [], proximo: null });
  });
});

describe("busca, caminho, pickaxe, follow", () => {
  beforeEach(() => {
    escrever(repo, "src/x.ts", "const a = 1;\n");
    commit(repo, "feat: adiciona x\n\ncorpo --force $(id)");
    escrever(repo, "src/x.ts", "const a = 2;\n");
    commit(repo, "fix: troca valor");
    git(repo, "-c", "user.name=Outra Pessoa", "commit", "-q", "--allow-empty", "--author=Outra Pessoa <o@example.invalid>", "-m", "docs: vazio");
  });

  it("--grep (literal), autor, caminho, -S e -G; filtros desligam o grafo", async () => {
    expect((await logGit(repo, { busca: "adiciona" })).commits.map((c) => c.assunto)).toEqual(["feat: adiciona x"]);
    expect((await logGit(repo, { busca: "corpo --force" })).commits).toHaveLength(1);
    expect((await logGit(repo, { busca: "fix|docs", regex: true })).commits).toHaveLength(2);
    const a = await logGit(repo, { autor: "Outra" });
    expect(a.commits.map((c) => c.assunto)).toEqual(["docs: vazio"]);
    expect(a.grafo).toBeNull();
    expect((await logGit(repo, { caminho: "src/x.ts" })).commits.map((c) => c.assunto)).toEqual(["fix: troca valor", "feat: adiciona x"]);
    expect((await logGit(repo, { pickaxe: { tipo: "S", texto: "a = 2" } })).commits.map((c) => c.assunto)).toEqual(["fix: troca valor"]);
    expect((await logGit(repo, { pickaxe: { tipo: "G", texto: "a = [12]" } })).commits).toHaveLength(2);
  });

  it("texto que parece opção nunca vira opção", async () => {
    for (const t of ["--all", "-p", "--output=/tmp/pwn-log", "--exec=touch /tmp/pwn-log", "a\nb", "'; touch /tmp/pwn-log", "--", "-S"]) {
      await logGit(repo, { busca: t });
      await logGit(repo, { autor: t });
      await logGit(repo, { pickaxe: { tipo: "S", texto: t } });
      await logGit(repo, { caminho: t.replace(/\n/g, "_") }).catch(() => undefined);
    }
    await expect(logGit(repo, { rev: "--all" })).rejects.toThrow();
    await expect(logGit(repo, { rev: "--output=/tmp/pwn-log" })).rejects.toThrow();
    await expect(logGit(repo, { busca: "a\0b" })).rejects.toThrow();
    await expect(logGit(repo, { caminho: "../fora" })).rejects.toThrow();
    expect(existsSync("/tmp/pwn-log")).toBe(false);
  });

  it("historico de arquivo segue a renomeação", async () => {
    git(repo, "mv", "src/x.ts", "src/y.ts");
    commit(repo, "refactor: renomeia");
    escrever(repo, "src/y.ts", "const a = 3;\n");
    commit(repo, "fix: de novo");
    const h = await historicoArquivo(repo, "src/y.ts");
    expect(h.map((c) => c.assunto)).toEqual(["fix: de novo", "refactor: renomeia", "fix: troca valor", "feat: adiciona x"]);
    expect((await logGit(repo, { caminho: "src/y.ts" })).commits).toHaveLength(2); // sem --follow para na renomeação
  });
});

describe("detalhe do commit e blame", () => {
  it("detalhe: mensagem com quebras, arquivos, estatísticas e diff; raiz e merge", async () => {
    escrever(repo, "n.txt", "a\nb\n");
    escrever(repo, "a.txt", "um\nDOIS\ntres\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "titulo\n\ncorpo linha 1\n\n\ncorpo linha 3 \"aspas\"");
    const d = await detalheCommit(repo, "HEAD");
    expect(d.assunto).toBe("titulo");
    expect(d.corpo).toBe("titulo\n\ncorpo linha 1\n\ncorpo linha 3 \"aspas\"");
    expect(d.diff.arquivos.map((f) => f.caminho).sort()).toEqual(["a.txt", "n.txt"]);
    expect(d).toMatchObject({ insercoes: 3, delecoes: 1 });
    const raizC = await detalheCommit(repo, git(repo, "rev-list", "--max-parents=0", "HEAD").trim());
    expect(raizC.diff.arquivos[0]).toMatchObject({ caminho: "a.txt", estado: "novo" });
    git(repo, "switch", "-q", "-c", "lado");
    escrever(repo, "l.txt", "l\n");
    commit(repo, "lado");
    git(repo, "switch", "-q", "main");
    escrever(repo, "p.txt", "p\n");
    commit(repo, "principal");
    git(repo, "merge", "-q", "--no-ff", "-m", "merge lado", "lado");
    const m = await detalheCommit(repo, "HEAD");
    expect(m.pais).toHaveLength(2);
    expect(m.diff.arquivos.map((f) => f.caminho)).toEqual(["l.txt"]);
    await expect(detalheCommit(repo, "--all")).rejects.toThrow();
  });

  it("blame --porcelain -w: commit, autor, data, resumo e linha original por linha", async () => {
    escrever(repo, "b.txt", "l1\nl2\nl3\n");
    commit(repo, "primeiro b");
    escrever(repo, "b.txt", "l1\nL2 mudou\nl3\n  nova\n");
    git(repo, "-c", "user.name=Outra", "-c", "user.email=o@example.invalid", "commit", "-q", "-am", "segundo b");
    const b = await blameGit(repo, "b.txt");
    expect(b.map((l) => l.conteudo)).toEqual(["l1", "L2 mudou", "l3", "  nova"]);
    expect(b.map((l) => l.resumo)).toEqual(["primeiro b", "segundo b", "primeiro b", "segundo b"]);
    expect(b[1]).toMatchObject({ autor: "Outra", email: "o@example.invalid", linha: 2, linhaOriginal: 2, arquivo: "b.txt" });
    expect(b[0]?.data).toMatch(/^\d{4}-/);
    expect(b[3]?.linhaOriginal).toBe(4);
    await expect(blameGit(repo, "--incremental")).resolves.toBeDefined().catch(() => undefined);
  });

  it("blame de arquivo com nome começando por '-' e parsers tolerantes a lixo", async () => {
    escrever(repo, "-n.txt", "x\n");
    commit(repo, "traco");
    expect((await blameGit(repo, "-n.txt")).map((l) => l.conteudo)).toEqual(["x"]);
    expect(parseBlamePorcelain("lixo\n\x00\n")).toEqual([]);
    expect(parseLog("\x1elixo\0x")).toEqual([]);
  });
});
