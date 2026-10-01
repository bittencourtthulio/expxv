import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { CONFLITOS_XY, parseStatusV2, statusGit, statusGitParcial } from "./status";
import { ExecutorVcs } from "../executor";
import { commit, escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta, scriptExecutavel } from "../../../../tests/fixtures/vcs/repos";

let raiz: string;
let repo: string;
beforeAll(isolarConfigGit);
beforeEach(() => {
  raiz = pastaTmp("vcs-st-");
  repo = initRepo(join(raiz, "r"));
});
afterEach(() => removerPasta(raiz));

describe("parseStatusV2 (puro)", () => {
  it("cabeçalhos: oid, branch, upstream, ahead/behind; HEAD destacado e repositório sem commits", () => {
    const s = parseStatusV2("# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +3 -2\0");
    expect(s).toMatchObject({ oid: "abc123", branch: "main", upstream: "origin/main", ahead: 3, behind: 2, semCommits: false });
    expect(parseStatusV2("# branch.oid (initial)\0# branch.head (detached)\0")).toMatchObject({ oid: null, branch: null, semCommits: true });
  });

  it("entradas 1/2/?/!: staged, não staged, renomeado com origem, caminho com espaço", () => {
    const h = "N... 100644 100644 100644 aaaa bbbb";
    const saida = [
      `1 M. ${h} com espaço.txt`,
      `1 .M ${h} b.txt`,
      `1 AM ${h} c.txt`,
      `2 R. ${h} R100 novo nome.txt`,
      "velho.txt",
      "? solto.txt",
      "! lixo.log",
      "",
    ].join("\0");
    const s = parseStatusV2(saida);
    expect(s.arquivos.map((a) => a.caminho)).toEqual(["com espaço.txt", "b.txt", "c.txt", "novo nome.txt", "solto.txt", "lixo.log"]);
    expect(s.arquivos[3]).toMatchObject({ tipo: "renomeado", origem: "velho.txt", indice: "R" });
    expect(s.contagens).toEqual({ staged: 3, naoStaged: 2, naoRastreados: 1, conflitos: 0, ignorados: 1 });
  });

  it("todos os sete códigos XY de conflito são mapeados", () => {
    const h = "N... 100644 100644 100644 100644 a b c";
    const xys = Object.keys(CONFLITOS_XY);
    expect(xys.sort()).toEqual(["AA", "AU", "DD", "DU", "UA", "UD", "UU"]);
    const saida = xys.map((xy) => `u ${xy} ${h} f-${xy}.txt`).join("\0") + "\0";
    const s = parseStatusV2(saida);
    expect(s.contagens.conflitos).toBe(7);
    for (const a of s.arquivos) {
      expect(a.tipo).toBe("conflito");
      expect(a.conflito).toBe(CONFLITOS_XY[a.caminho.slice(2, 4)]);
    }
  });

  it("submódulo sujo: flags e lixo/truncamento nunca lançam", () => {
    const s = parseStatusV2("1 .M SCM. 160000 160000 160000 a b libs/sub\0lixo\0u UU\0" + "1 M");
    expect(s.arquivos[0]).toMatchObject({ caminho: "libs/sub", submodulo: "CM" });
    expect(s.arquivos).toHaveLength(1);
  });
});

describe("statusGit (repositório real)", () => {
  it("limpo, depois com modificado, staged, renomeado e não rastreado", async () => {
    expect((await statusGit(repo)).arquivos).toEqual([]);
    escrever(repo, "orig.txt", "conteudo bem grande para ser reconhecido como renomeado\nlinha 2\nlinha 3\n");
    commit(repo, "orig");
    escrever(repo, "a.txt", "um\ndois\ntres\nquatro\n");
    escrever(repo, "novo.txt", "n");
    git(repo, "mv", "orig.txt", "renomeado.txt");
    git(repo, "add", "novo.txt");
    escrever(repo, "solto.txt", "s");
    const s = await statusGit(repo);
    expect(s.estado).toBe("pronto");
    expect(s.branch).toBe("main");
    expect(s.degradado).toBe(false);
    const por = Object.fromEntries(s.arquivos.map((a) => [a.caminho, a]));
    expect(por["a.txt"]).toMatchObject({ indice: " ", arvore: "M" });
    expect(por["novo.txt"]).toMatchObject({ indice: "A" });
    expect(por["renomeado.txt"]).toMatchObject({ tipo: "renomeado", origem: "orig.txt" });
    expect(por["solto.txt"]?.tipo).toBe("naorastreado");
    expect(s.contagens).toMatchObject({ staged: 2, naoStaged: 1, naoRastreados: 1, conflitos: 0 });
  });

  it("ahead/behind contra upstream local e ignorados opcionais", async () => {
    const remoto = join(raiz, "remoto.git");
    git(raiz, "init", "-q", "--bare", "-b", "main", remoto);
    git(repo, "remote", "add", "origin", remoto);
    git(repo, "push", "-q", "-u", "origin", "main");
    escrever(repo, "b.txt", "b");
    commit(repo, "b");
    escrever(repo, ".gitignore", "*.log\n");
    commit(repo, "ig");
    escrever(repo, "x.log", "l");
    const s = await statusGit(repo, { ignorados: true });
    expect(s).toMatchObject({ upstream: "origin/main", ahead: 2, behind: 0 });
    expect(s.arquivos.find((a) => a.caminho === "x.log")?.tipo).toBe("ignorado");
    expect((await statusGit(repo)).arquivos.some((a) => a.caminho === "x.log")).toBe(false);
  });

  it("conflito real de merge mapeia UU/AA/DU/UD", async () => {
    escrever(repo, "c.txt", "base\n");
    escrever(repo, "d.txt", "base d\n");
    escrever(repo, "e.txt", "base e\n");
    commit(repo, "base");
    git(repo, "checkout", "-q", "-b", "outro");
    escrever(repo, "c.txt", "outro\n");
    rmSync(join(repo, "d.txt"));
    escrever(repo, "e.txt", "e outro\n");
    escrever(repo, "f.txt", "f outro\n");
    commit(repo, "outro");
    git(repo, "checkout", "-q", "main");
    escrever(repo, "c.txt", "main\n");
    escrever(repo, "d.txt", "d main\n");
    rmSync(join(repo, "e.txt"));
    escrever(repo, "f.txt", "f main\n");
    commit(repo, "main");
    try {
      git(repo, "merge", "outro");
    } catch {
      /* esperado */
    }
    const s = await statusGit(repo);
    const por = Object.fromEntries(s.arquivos.map((a) => [a.caminho, a.conflito]));
    expect(por).toEqual({ "c.txt": "ambos-modificaram", "d.txt": "apagado-por-eles", "e.txt": "apagado-por-nos", "f.txt": "ambos-adicionaram" });
    expect(s.contagens.conflitos).toBe(4);
  });

  it("repositório sem commits: semCommits e branch", async () => {
    const novo = initRepo(join(raiz, "novo"), false);
    escrever(novo, "x.txt", "x");
    const s = await statusGit(novo);
    expect(s).toMatchObject({ semCommits: true, branch: "main", oid: null });
    expect(s.arquivos[0]?.tipo).toBe("naorastreado");
  });

  it("fora de repositório: NaoEhRepoErro", async () => {
    await expect(statusGit(raiz)).rejects.toMatchObject({ name: "NaoEhRepoErro" });
  });

  it("degrada para -uno quando o status completo passa do limite", async () => {
    // git "falso": a chamada com untracked=normal demora; a com =no responde na hora.
    const falso = scriptExecutavel(
      join(raiz, "gitlento.sh"),
      `case "$*" in *untracked-files=normal*) sleep 5 ;; esac\nprintf '# branch.head main\\0# branch.oid abc\\0'`,
    );
    const ex = new ExecutorVcs();
    const s = await statusGit(repo, { executor: ex, executavel: falso, limiteDegradarMs: 300 });
    expect(s.degradado).toBe(true);
    expect(s.branch).toBe("main");
    const rapido = await statusGit(repo, { executor: ex, executavel: falso, semNaoRastreados: true });
    expect(rapido.degradado).toBe(true);
  });

  it("cancelar por signal propaga o erro de cancelamento (sem degradar)", async () => {
    const falso = scriptExecutavel(join(raiz, "gitlento2.sh"), `sleep 5`);
    const ac = new AbortController();
    const p = statusGit(repo, { executavel: falso, signal: ac.signal, limiteDegradarMs: 5000 });
    setTimeout(() => ac.abort(), 100);
    await expect(p).rejects.toMatchObject({ name: "GitCanceladoErro" });
  });
});



describe("statusGitParcial (incremental)", () => {
  const semDuracao = <T extends { duracaoMs: number; parcial?: true }>(s: T): Omit<T, "duracaoMs" | "parcial"> => {
    const { duracaoMs, parcial, ...resto } = s;
    void duracaoMs;
    void parcial;
    return resto;
  };

  it("mescla só o que mudou e fica IDÊNTICO ao status completo (edição, stage, apagar, restaurar)", async () => {
    for (let i = 0; i < 12; i++) escrever(repo, `d/f${i}.txt`, `conteudo ${i}\n`);
    commit(repo, "muitos");
    let atual = await statusGit(repo);
    expect(atual.arquivos).toEqual([]);
    const passos: Array<[string, () => void, string[]]> = [
      ["editar", () => escrever(repo, "d/f3.txt", "mudou\n"), ["d/f3.txt"]],
      ["editar outro", () => escrever(repo, "d/f9.txt", "mudou\n"), ["d/f9.txt"]],
      ["stage", () => git(repo, "add", "d/f3.txt"), ["d/f3.txt"]],
      ["editar de novo (staged + não staged)", () => escrever(repo, "d/f3.txt", "mudou2\n"), ["d/f3.txt"]],
      ["apagar", () => rmSync(join(repo, "d/f5.txt")), ["d/f5.txt"]],
      ["restaurar edição", () => escrever(repo, "d/f9.txt", "conteudo 9\n"), ["d/f9.txt"]],
      ["vários de uma vez", () => { escrever(repo, "d/f1.txt", "x\n"); escrever(repo, "d/f2.txt", "y\n"); }, ["d/f1.txt", "d/f2.txt", "d/f4.txt"]],
    ];
    for (const [nome, op, caminhos] of passos) {
      op();
      const parcial = await statusGitParcial(repo, atual, caminhos);
      const cheio = await statusGit(repo);
      expect(parcial, nome).not.toBeNull();
      expect(parcial?.parcial).toBe(true);
      expect(semDuracao(parcial!), nome).toEqual(semDuracao(cheio));
      atual = parcial!;
    }
  });

  it("recua (null) quando o atalho não é seguro: arquivo novo, renomeação, pasta não rastreada, base não pronta, caminhos ruins", async () => {
    const base = await statusGit(repo);
    escrever(repo, "novo.txt", "x");
    expect(await statusGitParcial(repo, base, ["novo.txt"])).toBeNull();
    expect(await statusGitParcial(repo, { ...base, estado: "calculando" }, ["a.txt"])).toBeNull();
    expect(await statusGitParcial(repo, base, [])).toBeNull();
    expect(await statusGitParcial(repo, base, ["../fora"])).toBeNull();
    expect(await statusGitParcial(repo, base, Array.from({ length: 51 }, (_, i) => `f${i}`))).toBeNull();
    escrever(repo, "orig.txt", "conteudo grande o bastante para detectar renomeação\nlinha 2\nlinha 3\n");
    commit(repo, "o");
    git(repo, "mv", "orig.txt", "ren.txt");
    const comRen = await statusGit(repo);
    expect(await statusGitParcial(repo, comRen, ["ren.txt"])).toBeNull();
    expect(await statusGitParcial(repo, comRen, ["orig.txt"])).toBeNull();
    escrever(repo, "pasta/x.txt", "x");
    const comDir = await statusGit(repo);
    expect(comDir.arquivos.some((a) => a.caminho === "pasta/")).toBe(true);
    expect(await statusGitParcial(repo, comDir, ["pasta/x.txt"])).toBeNull();
  });

  it("caminhos com espaço, aspas e acento são literais (não viram pathspec mágico)", async () => {
    escrever(repo, "com espaço.txt", "1");
    escrever(repo, "*.txt", "2");
    escrever(repo, ":(top)x", "3");
    commit(repo, "estranhos");
    const base = await statusGit(repo);
    escrever(repo, "com espaço.txt", "mudou");
    escrever(repo, ":(top)x", "mudou");
    const p = await statusGitParcial(repo, base, ["com espaço.txt", ":(top)x"]);
    expect(p?.arquivos.map((a) => a.caminho).sort()).toEqual([":(top)x", "com espaço.txt"]);
  });
});
