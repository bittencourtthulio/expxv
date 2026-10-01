import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { caminhoRelativoSeguro, desaspar, diffGit, ParserDiff, parseDiff } from "./diff";
import { commit, escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-df-");
  repo = initRepo(join(raiz, "r"));
});
afterEach(() => removerPasta(raiz));

const UNIFICADO = [
  "diff --git a/f.txt b/f.txt",
  "index 111..222 100644",
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,4 +1,3 @@ funcao()",
  " um",
  "-dois",
  "+DOIS",
  "--- tres",
  " quatro",
  "\\ No newline at end of file",
  "",
].join("\n");

describe("parser (puro)", () => {
  it("unified: hunks com linhas numeradas; '--- ' dentro do corpo é remoção, não cabeçalho", () => {
    const d = parseDiff(UNIFICADO);
    expect(d.arquivos).toHaveLength(1);
    const f = d.arquivos[0]!;
    expect(f).toMatchObject({ caminho: "f.txt", estado: "modificado", insercoes: 1, delecoes: 2 });
    const h = f.hunks[0]!;
    expect(h).toMatchObject({ antigaInicio: 1, antigaQtd: 4, novaInicio: 1, novaQtd: 3, secao: "funcao()" });
    expect(h.linhas.map((l) => `${l.tipo}:${l.antiga}:${l.nova}:${l.texto}`)).toEqual([
      "ctx:1:1:um", "del:2:null:dois", "add:null:2:DOIS", "del:3:null:-- tres", "ctx:4:3:quatro",
    ]);
    expect(h.linhas[4]?.semFim).toBe(true);
    expect(h.incompleto).toBeUndefined();
  });

  it("truncado em qualquer byte nunca lança e marca incompleto", () => {
    for (let corte = 0; corte <= UNIFICADO.length; corte += 3) {
      const d = parseDiff(UNIFICADO.slice(0, corte), { truncado: true });
      expect(Array.isArray(d.arquivos)).toBe(true);
      expect(d.truncado).toBe(true);
    }
    const meio = parseDiff(UNIFICADO.slice(0, UNIFICADO.indexOf("DOIS") + 2), { truncado: true });
    expect(meio.arquivos[0]?.hunks[0]?.incompleto).toBe(true);
  });

  it("lixo, cabeçalho de hunk inválido e arquivo vazio não lançam", () => {
    expect(parseDiff("").arquivos).toEqual([]);
    expect(parseDiff("lixo\n@@ x\n+a\n").arquivos).toEqual([]);
    expect(parseDiff("diff --git a/x b/x\n@@ quebrado @@\n+a\n-b\n").arquivos[0]?.hunks).toEqual([]);
    expect(parseDiff("diff --git x\n\0\0\n").arquivos).toHaveLength(1);
  });

  it("contagem de hunk errada: o próximo 'diff --git' não é engolido", () => {
    const d = parseDiff("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,9 +1,9 @@\n x\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-1\n+2\n");
    expect(d.arquivos.map((a) => a.caminho)).toEqual(["a", "b"]);
    expect(d.arquivos[0]?.hunks[0]?.incompleto).toBe(true);
    expect(d.arquivos[1]?.insercoes).toBe(1);
  });

  it("chunks de qualquer tamanho (inclusive UTF-8 partido ao meio) dão o mesmo resultado", () => {
    const txt = "diff --git a/é.txt b/é.txt\n--- a/é.txt\n+++ b/é.txt\n@@ -1 +1 @@\n-ação\n+coração\n";
    const inteiro = parseDiff(txt);
    const p = new ParserDiff();
    const buf = Buffer.from(txt);
    for (let i = 0; i < buf.length; i += 3) p.escrever(buf.subarray(i, i + 3));
    expect(p.finalizar()).toEqual(inteiro);
    expect(inteiro.arquivos[0]?.hunks[0]?.linhas[1]?.texto).toBe("coração");
  });

  it("renomeação com similaridade e cópia", () => {
    const d = parseDiff(
      [
        "diff --git a/velho nome.txt b/novo nome.txt", "similarity index 92%", "rename from velho nome.txt", "rename to novo nome.txt", "index 1..2 100644",
        "--- a/velho nome.txt\t", "+++ b/novo nome.txt\t", "@@ -1 +1 @@", "-a", "+b",
        "diff --git a/o.txt b/c.txt", "similarity index 100%", "copy from o.txt", "copy to c.txt", "",
      ].join("\n"),
    );
    expect(d.arquivos[0]).toMatchObject({ estado: "renomeado", caminhoAntigo: "velho nome.txt", caminho: "novo nome.txt", similaridade: 92 });
    expect(d.arquivos[1]).toMatchObject({ estado: "copiado", caminhoAntigo: "o.txt", caminho: "c.txt", similaridade: 100, hunks: [] });
  });

  it("binário, mudança de modo, novo e apagado", () => {
    const d = parseDiff(
      [
        "diff --git a/i.png b/i.png", "index 1..2 100644", "Binary files a/i.png and b/i.png differ",
        "diff --git a/run.sh b/run.sh", "old mode 100644", "new mode 100755",
        "diff --git a/n.txt b/n.txt", "new file mode 100644", "index 0000000..1 100644", "--- /dev/null", "+++ b/n.txt", "@@ -0,0 +1 @@", "+x",
        "diff --git a/d.txt b/d.txt", "deleted file mode 100644", "--- a/d.txt", "+++ /dev/null", "@@ -1 +0,0 @@", "-x", "",
      ].join("\n"),
    );
    expect(d.arquivos[0]).toMatchObject({ caminho: "i.png", binario: true, hunks: [] });
    expect(d.arquivos[1]).toMatchObject({ caminho: "run.sh", mudouModo: true, modoAntigo: "100644", modoNovo: "100755" });
    expect(d.arquivos[2]).toMatchObject({ estado: "novo", modoNovo: "100644", insercoes: 1 });
    expect(d.arquivos[3]).toMatchObject({ estado: "apagado", delecoes: 1 });
  });

  it("submódulo: ponteiro antigo/novo e sujo", () => {
    const d = parseDiff(
      ["diff --git a/libs/s b/libs/s", "index 1..2 160000", "--- a/libs/s", "+++ b/libs/s", "@@ -1 +1 @@", "-Subproject commit aaaaaaaa", "+Subproject commit bbbbbbbb-dirty", ""].join("\n"),
    );
    expect(d.arquivos[0]?.submodulo).toEqual({ de: "aaaaaaaa", para: "bbbbbbbb", sujo: true });
  });

  it("fim de linha: CRLF detectado, \\r fora do texto, 'só fim de linha' reconhecido", () => {
    const d = parseDiff(
      ["diff --git a/w.txt b/w.txt", "--- a/w.txt", "+++ b/w.txt", "@@ -1,2 +1,2 @@", "-a", "-b", "+a\r", "+b\r", ""].join("\n"),
    );
    expect(d.arquivos[0]).toMatchObject({ eol: "misto", soFimDeLinha: true });
    expect(d.arquivos[0]?.hunks[0]?.linhas[2]?.texto).toBe("a");
    const so = parseDiff(["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1 +1 @@", "+novo\r", "-velho\r", ""].join("\n"));
    expect(so.arquivos[0]).toMatchObject({ eol: "crlf", soFimDeLinha: false });
  });

  it("caminhos entre aspas (octal/escapes) são desfeitos", () => {
    expect(desaspar('"a\\tb\\303\\251\\"x"')).toBe('a\tbé"x');
    expect(desaspar("plano")).toBe("plano");
    const d = parseDiff('diff --git "a/x\\ty" "b/x\\ty"\nnew file mode 100644\n');
    expect(d.arquivos[0]?.caminho).toBe("x\ty");
  });

  it("word-diff porcelain: partes por linha, tipos add/del/mod e numeração", () => {
    const txt = ["diff --git a/f b/f", "--- a/f", "+++ b/f", "@@ -1,3 +1,3 @@", " igual ", "~", " troca ", "-velha", "+nova", " fim", "~", "+so nova", "~", ""].join("\n");
    const d = parseDiff(txt, { palavra: true });
    const ls = d.arquivos[0]!.hunks[0]!.linhas;
    expect(ls.map((l) => l.tipo)).toEqual(["ctx", "mod", "add"]);
    expect(ls[1]?.partes?.map((p) => `${p.tipo}:${p.texto}`)).toEqual(["ctx:troca ", "del:velha", "add:nova", "ctx:fim"]);
    expect(ls[1]).toMatchObject({ antiga: 2, nova: 2, texto: "troca velhafim" });
    expect(ls[2]).toMatchObject({ antiga: null, nova: 3 });
  });
});

describe("caminhoRelativoSeguro", () => {
  it("rejeita absoluto, .. e NUL", () => {
    expect(caminhoRelativoSeguro("a\\b.txt")).toBe("a/b.txt");
    for (const ruim of ["/etc/passwd", "../x", "a/../../x", "", "C:\\x", "a\0b"]) expect(() => caminhoRelativoSeguro(ruim)).toThrow();
  });
});

describe("diffGit (repositório real)", () => {
  it("modificação, staged vs não staged, caminho único e contexto", async () => {
    escrever(repo, "a.txt", "um\nDOIS\ntres\n");
    const nao = await diffGit(repo);
    expect(nao.arquivos).toHaveLength(1);
    expect(nao.arquivos[0]).toMatchObject({ caminho: "a.txt", insercoes: 1, delecoes: 1 });
    expect(nao.grande).toBe(false);
    expect((await diffGit(repo, { staged: true })).arquivos).toEqual([]);
    git(repo, "add", "a.txt");
    expect((await diffGit(repo, { staged: true })).arquivos).toHaveLength(1);
    expect((await diffGit(repo, { staged: true, caminho: "a.txt", contexto: 0 })).arquivos[0]?.hunks[0]?.linhas).toHaveLength(2);
  });

  it("renomeação, novo arquivo binário, mudança de modo, CRLF e base...HEAD", async () => {
    escrever(repo, "grande.txt", Array.from({ length: 40 }, (_, i) => `linha ${i}`).join("\n") + "\n");
    escrever(repo, "run.sh", "echo\n");
    commit(repo, "base");
    git(repo, "checkout", "-q", "-b", "feat");
    git(repo, "mv", "grande.txt", "renomeado.txt");
    escrever(repo, "renomeado.txt", Array.from({ length: 40 }, (_, i) => (i === 5 ? "mudou" : `linha ${i}`)).join("\n") + "\n");
    chmodSync(join(repo, "run.sh"), 0o755);
    escrever(repo, "bin.dat", Buffer.from([0, 1, 2, 0, 255, 0]));
    escrever(repo, "crlf.txt", "a\r\nb\r\n");
    commit(repo, "feat");
    const d = await diffGit(repo, { base: "main" });
    const por = Object.fromEntries(d.arquivos.map((a) => [a.caminho, a]));
    expect(por["renomeado.txt"]).toMatchObject({ estado: "renomeado", caminhoAntigo: "grande.txt", insercoes: 1, delecoes: 1 });
    expect(por["run.sh"]).toMatchObject({ mudouModo: true, modoNovo: "100755" });
    expect(por["bin.dat"]).toMatchObject({ binario: true, estado: "novo" });
    expect(por["crlf.txt"]).toMatchObject({ eol: "crlf", estado: "novo" });
  });

  it("arquivo não rastreado vira diff de arquivo novo; caminho fora do repo é recusado", async () => {
    escrever(repo, "pasta/solto com espaço.txt", "x\ny\n");
    const d = await diffGit(repo, { naoRastreado: true, caminho: "pasta/solto com espaço.txt" });
    expect(d.arquivos[0]).toMatchObject({ estado: "novo", insercoes: 2, caminho: "pasta/solto com espaço.txt" });
    await expect(diffGit(repo, { naoRastreado: true, caminho: "../fora.txt" })).rejects.toBeTruthy();
    await expect(diffGit(repo, { caminho: "/etc/hosts" })).rejects.toBeTruthy();
    await expect(diffGit(repo, { base: "--output=x" })).rejects.toBeTruthy();
  });

  it("word-diff real", async () => {
    escrever(repo, "a.txt", "um\ndois dois\ntres\n");
    const d = await diffGit(repo, { palavra: true });
    const l = d.arquivos[0]!.hunks[0]!.linhas.find((x) => x.tipo === "mod");
    expect(l?.partes?.some((p) => p.tipo === "add")).toBe(true);
  });

  it("submódulo: ponteiro novo aparece em diff --cached", async () => {
    const sub = initRepo(join(raiz, "sub"));
    git(repo, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "libs/sub");
    const d = await diffGit(repo, { staged: true, caminho: "libs/sub" });
    expect(d.arquivos[0]?.submodulo?.para).toMatch(/^[0-9a-f]{7,}$/);
  });

  it("limite de tamanho: diff grande é marcado, truncado e o parser entrega o que veio", async () => {
    escrever(repo, "enorme.txt", Array.from({ length: 5000 }, (_, i) => `linha numero ${i} com algum texto`).join("\n") + "\n");
    git(repo, "add", "enorme.txt");
    const d = await diffGit(repo, { staged: true, limiteBytes: 20_000 });
    expect(d).toMatchObject({ grande: true, truncado: true });
    expect(d.arquivos[0]?.hunks[0]?.incompleto).toBe(true);
    expect(d.arquivos[0]!.hunks[0]!.linhas.length).toBeGreaterThan(100);
    // arquivo não rastreado acima do limite nem é lido
    escrever(repo, "outro.txt", "x".repeat(50_000));
    const nr = await diffGit(repo, { naoRastreado: true, caminho: "outro.txt", limiteBytes: 10_000 });
    expect(nr).toMatchObject({ grande: true, truncado: true });
  });

  it("cancelar um diff em andamento rejeita com cancelamento", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(diffGit(repo, { signal: ac.signal })).rejects.toMatchObject({ name: "GitCanceladoErro" });
  });
});
