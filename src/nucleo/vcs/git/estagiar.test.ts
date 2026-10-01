import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { descartar, desestagiarArquivos, desestagiarHunk, desestagiarLinhas, desfazerDescarte, estagiarArquivos, estagiarHunk, estagiarLinhas, ignorar, listarDescartes } from "./estagiar";
import { diffGit } from "./diff";
import { commit, escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-es-");
  repo = initRepo(join(raiz, "r"));
});
afterEach(() => removerPasta(raiz));

const numeradas = (n: number, eol = "\n"): string => Array.from({ length: n }, (_, i) => `linha${i + 1}`).join(eol) + eol;
const noIndice = (c: string): string => git(repo, "show", `:${c}`);

describe("arquivo", () => {
  it("estagia e desestagia (inclui novo, apagado e renomeado)", async () => {
    escrever(repo, "novo.txt", "n\n");
    renameSync(join(repo, "a.txt"), join(repo, "b.txt"));
    await estagiarArquivos(repo, ["novo.txt", "a.txt", "b.txt"]);
    expect(git(repo, "status", "--porcelain")).toMatch(/A {2}novo.txt/);
    expect(git(repo, "status", "--porcelain")).toMatch(/R {2}a.txt -> b.txt/);
    await desestagiarArquivos(repo, ["novo.txt", "a.txt", "b.txt"]);
    const st = git(repo, "status", "--porcelain");
    expect(st).toContain("?? novo.txt");
    expect(st).not.toMatch(/^[AMRD]/m);
  });

  it("repositório sem commits desestagia com rm --cached", async () => {
    const vazio = initRepo(join(raiz, "v"), false);
    escrever(vazio, "x.txt", "x\n");
    await estagiarArquivos(vazio, ["x.txt"]);
    await desestagiarArquivos(vazio, ["x.txt"]);
    expect(git(vazio, "status", "--porcelain")).toContain("?? x.txt");
  });
});

describe("hunk e linha", () => {
  it("estagia só o hunk escolhido e desfaz", async () => {
    escrever(repo, "g.txt", numeradas(30));
    commit(repo, "g");
    const atual = numeradas(30).replace("linha2\n", "DOIS\n").replace("linha28\n", "VINTE8\n");
    escrever(repo, "g.txt", atual);
    const d = await diffGit(repo, { caminho: "g.txt" });
    expect(d.arquivos[0]?.hunks).toHaveLength(2);
    await estagiarHunk(repo, "g.txt", 1);
    const staged = noIndice("g.txt");
    expect(staged).toContain("VINTE8");
    expect(staged).not.toContain("DOIS");
    expect(readFileSync(join(repo, "g.txt"), "utf8")).toBe(atual);
    await desestagiarHunk(repo, "g.txt", 0);
    expect(noIndice("g.txt")).not.toContain("VINTE8");
  });

  it("linhas: estagia só as escolhidas dentro do hunk e desestagia parte", async () => {
    escrever(repo, "h.txt", "a\nb\nc\nd\n");
    commit(repo, "h");
    escrever(repo, "h.txt", "a\nB\nc\nd\nE\n");
    const d = await diffGit(repo, { caminho: "h.txt" });
    const linhas = d.arquivos[0]!.hunks[0]!.linhas;
    const idxAddB = linhas.findIndex((l) => l.tipo === "add" && l.texto === "B");
    const idxDelB = linhas.findIndex((l) => l.tipo === "del" && l.texto === "b");
    await estagiarLinhas(repo, "h.txt", 0, [idxDelB, idxAddB]);
    expect(noIndice("h.txt")).toBe("a\nB\nc\nd\n");
    await desestagiarLinhas(repo, "h.txt", 0, [idxAddB, idxDelB]);
    expect(noIndice("h.txt")).toBe("a\nb\nc\nd\n");
    expect(() => git(repo, "diff", "--quiet")).toThrow(); // árvore segue com tudo
  });

  it("hunk parcial correto em arquivo com CRLF (índice mantém CRLF)", async () => {
    escrever(repo, "w.txt", numeradas(30, "\r\n"));
    commit(repo, "w");
    const novo = numeradas(30, "\r\n").replace("linha3\r\n", "TRES\r\n").replace("linha27\r\n", "VINTE7\r\n");
    escrever(repo, "w.txt", novo);
    await estagiarHunk(repo, "w.txt", 0);
    const esperado = numeradas(30, "\r\n").replace("linha3\r\n", "TRES\r\n");
    expect(noIndice("w.txt")).toBe(esperado);
    const d = await diffGit(repo, { caminho: "w.txt", staged: true });
    expect(d.arquivos[0]?.eol).toBe("crlf");
    // por linha em CRLF
    const dd = await diffGit(repo, { caminho: "w.txt" });
    const l = dd.arquivos[0]!.hunks[0]!.linhas;
    await estagiarLinhas(repo, "w.txt", 0, [l.findIndex((x) => x.tipo === "del"), l.findIndex((x) => x.tipo === "add")]);
    expect(noIndice("w.txt")).toBe(novo);
  });

  it("arquivo sem newline no fim", async () => {
    escrever(repo, "s.txt", "a\nb\nc");
    commit(repo, "s");
    escrever(repo, "s.txt", "A\nb\nc");
    await estagiarHunk(repo, "s.txt", 0);
    expect(noIndice("s.txt")).toBe("A\nb\nc");
    escrever(repo, "s.txt", "A\nb\nCCC");
    await estagiarHunk(repo, "s.txt", 0);
    expect(noIndice("s.txt")).toBe("A\nb\nCCC");
  });

  it("arquivo novo: estagia linhas escolhidas e renomeado com edição", async () => {
    escrever(repo, "n.txt", "1\n2\n3\n");
    await estagiarLinhas(repo, "n.txt", 0, [0, 2]);
    expect(noIndice("n.txt")).toBe("1\n3\n");
    git(repo, "mv", "a.txt", "r.txt");
    escrever(repo, "r.txt", "um\nDOIS\ntres\n");
    await estagiarHunk(repo, "r.txt", 0);
    expect(noIndice("r.txt")).toBe("um\nDOIS\ntres\n");
  });

  it("índices inválidos e binário dão erro nominal sem tocar no índice", async () => {
    escrever(repo, "a.txt", "um\nDOIS\ntres\n");
    await expect(estagiarHunk(repo, "a.txt", 5)).rejects.toThrow(/Hunk 5/);
    await expect(estagiarLinhas(repo, "a.txt", 0, [99])).rejects.toThrow(/Linha inválida/);
    await expect(estagiarLinhas(repo, "a.txt", 0, [0])).rejects.toThrow(/Nenhuma linha/);
    await expect(estagiarHunk(repo, "../fora.txt", 0)).rejects.toThrow();
    expect(git(repo, "diff", "--cached", "--name-only")).toBe("");
  });

  it("nome de arquivo começando com '-' ou com espaço/aspas nunca vira opção", async () => {
    for (const nome of ["-rf.txt", "--force.txt", "com espaco.txt", "aspa'dupla\".txt"]) {
      escrever(repo, nome, "x\n");
      await estagiarArquivos(repo, [nome]);
      expect(git(repo, "ls-files", "-z", "--", nome)).toContain(nome);
    }
    escrever(repo, "*.txt", "g\n");
    await estagiarArquivos(repo, ["*.txt"]); // literal: não expande glob
    expect(git(repo, "ls-files", "-z")).toContain("*.txt");
  });
});

describe("ignorar", () => {
  it("acrescenta sem duplicar, preserva conteúdo e CRLF", async () => {
    writeFileSync(join(repo, ".gitignore"), "dist\r\nnode_modules");
    const r = await ignorar(repo, ["dist", "*.log", "/tmp/"]);
    expect(r).toEqual({ adicionados: ["*.log", "/tmp/"], jaExistiam: ["dist"] });
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe("dist\r\nnode_modules\r\n*.log\r\n/tmp/\r\n");
    await expect(ignorar(repo, ["a\nb"])).rejects.toThrow();
    await expect(ignorar(repo, ["!x"])).rejects.toThrow();
    await expect(ignorar(repo, ["  "])).rejects.toThrow();
  });
  it("cria o arquivo quando não existe", async () => {
    await ignorar(repo, ["x.bin"]);
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe("x.bin\n");
  });
});

describe("descartar", () => {
  it("rastreado: guarda cópia, restaura e permite desfazer; simular não age", async () => {
    const seg = join(raiz, "seguranca");
    const lixo: string[] = [];
    const opc = { pastaSeguranca: seg, moverParaLixeira: async (p: string) => void lixo.push(p) };
    escrever(repo, "a.txt", "trabalho precioso\n");
    const sim = await descartar(repo, ["a.txt"], { ...opc, simular: true });
    expect(sim).toMatchObject({ simulado: true, idDesfazer: null });
    expect(sim.itens[0]).toMatchObject({ caminho: "a.txt", acao: "restaurar", insercoes: 1, delecoes: 3 });
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("trabalho precioso\n");
    expect(existsSync(seg)).toBe(false);

    const r = await descartar(repo, ["a.txt"], opc);
    expect(r.idDesfazer).not.toBeNull();
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("um\ndois\ntres\n");
    expect((await listarDescartes(repo, seg))[0]?.arquivos).toEqual(["a.txt"]);

    const d = await desfazerDescarte(repo, r.idDesfazer as string, { pastaSeguranca: seg });
    expect(d.restaurados).toEqual(["a.txt"]);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("trabalho precioso\n");
    await expect(desfazerDescarte(repo, r.idDesfazer as string, { pastaSeguranca: seg })).rejects.toThrow(/já foi desfeito/);
    expect(lixo).toEqual([]);
  });

  it("desfazer com arquivo mexido depois devolve conflito e não toca em nada", async () => {
    const seg = join(raiz, "seg");
    const opc = { pastaSeguranca: seg, moverParaLixeira: async () => undefined };
    escrever(repo, "a.txt", "v1\n");
    const r = await descartar(repo, ["a.txt"], opc);
    escrever(repo, "a.txt", "v2 novo\n");
    const d = await desfazerDescarte(repo, r.idDesfazer as string, { pastaSeguranca: seg });
    expect(d.conflitos).toEqual(["a.txt"]);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("v2 novo\n");
    const f = await desfazerDescarte(repo, r.idDesfazer as string, { pastaSeguranca: seg, sobrescrever: true });
    expect(f.restaurados).toEqual(["a.txt"]);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("v1\n");
  });

  it("não rastreado vai para a lixeira injetada, nunca é apagado pelo código", async () => {
    const lixo: string[] = [];
    escrever(repo, "novo.txt", "n\n");
    escrever(repo, "pasta/dentro.txt", "d\n");
    const r = await descartar(repo, ["novo.txt", "pasta"], { pastaSeguranca: join(raiz, "s"), moverParaLixeira: async (p) => void lixo.push(p) });
    expect(r.idDesfazer).toBeNull();
    expect(lixo.sort()).toEqual([join(repo, "novo.txt"), join(repo, "pasta/dentro.txt")].sort());
    expect(existsSync(join(repo, "novo.txt"))).toBe(true); // o dublê não move: prova que o código não remove
  });

  it("incluirStaged: arquivo novo no índice sai do índice e vai para a lixeira; staged modificado volta ao HEAD", async () => {
    const lixo: string[] = [];
    const mover = async (p: string): Promise<void> => {
      lixo.push(p);
      renameSync(p, join(raiz, "lixeira-falsa.txt")); // como a lixeira do sistema: o arquivo sai da árvore
    };
    const opc = { pastaSeguranca: join(raiz, "s"), moverParaLixeira: mover, incluirStaged: true };
    escrever(repo, "n.txt", "n\n");
    escrever(repo, "a.txt", "mod\n");
    git(repo, "add", "-A");
    const r = await descartar(repo, ["n.txt", "a.txt"], opc);
    expect(git(repo, "status", "--porcelain").trim()).toBe("");
    expect(lixo).toEqual([join(repo, "n.txt")]);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("um\ndois\ntres\n");
    expect(r.idDesfazer).not.toBeNull();
    await desfazerDescarte(repo, r.idDesfazer as string, { pastaSeguranca: join(raiz, "s") });
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("mod\n");
  });

  it("conflito e caminho sem mudança são ignorados; caminho malicioso é recusado", async () => {
    const opc = { pastaSeguranca: join(raiz, "s"), moverParaLixeira: async () => undefined };
    const r = await descartar(repo, ["a.txt"], opc);
    expect(r.itens).toEqual([{ caminho: "a.txt", acao: "ignorado", motivo: "sem mudanças" }]);
    await expect(descartar(repo, ["../x"], opc)).rejects.toThrow();
    await expect(descartar(repo, ["/etc/passwd"], opc)).rejects.toThrow();
  });
});
