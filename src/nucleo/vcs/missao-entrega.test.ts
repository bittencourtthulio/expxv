import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lerCommitsDaEntrega, parseCommitsDaEntrega } from "./missao-entrega";
import { lerPrDaEntrega } from "./pr-estado";

const tmps: string[] = [];
afterEach(() => { while (tmps.length) rmSync(tmps.pop() as string, { recursive: true, force: true }); });

describe("parseCommitsDaEntrega", () => {
  it("lê a lista de blocos", () => {
    const md = "---\nexpx_tool: runx\nbranch: feature/x\ncommits:\n  - task: T-01.01\n    commit: abc1234\n  - task: T-01.02\n    commit: \"def5678901\"\nportao: ok\n---\n# corpo\n- commit: 0000000\n";
    expect(parseCommitsDaEntrega(md)).toEqual([{ task: "T-01.01", commit: "abc1234" }, { task: "T-01.02", commit: "def5678901" }]);
  });
  it("aceita fluxo inline, ordem invertida e itens só com hash", () => {
    const md = "---\ncommits:\n  - {task: T-1, commit: aaaaaaa}\n  - commit: bbbbbbb\n    task: T-2\n  - ccccccc\n---\n";
    expect(parseCommitsDaEntrega(md)).toEqual([{ task: "T-1", commit: "aaaaaaa" }, { task: "T-2", commit: "bbbbbbb" }, { task: null, commit: "ccccccc" }]);
  });
  it("ignora hash inválido, duplicado, sem frontmatter ou sem commits", () => {
    expect(parseCommitsDaEntrega("sem frontmatter")).toEqual([]);
    expect(parseCommitsDaEntrega("---\ncommits:\n  - task: a\n    commit: xyz\n  - task: b\n    commit: ABCDEF1\n  - task: c\n    commit: abcdef1\n---\n")).toEqual([{ task: "c", commit: "abcdef1" }]);
    expect(parseCommitsDaEntrega("---\ncommits: []\n---\n")).toEqual([]);
  });
  it("teto de 500 itens", () => {
    const itens = Array.from({ length: 600 }, (_, i) => `  - task: T${i}\n    commit: ${(i + 0x1000000).toString(16)}`).join("\n");
    expect(parseCommitsDaEntrega(`---\ncommits:\n${itens}\n---\n`)).toHaveLength(500);
  });
});

describe("lerCommitsDaEntrega", () => {
  it("lê docs/entregas/<id>/ENTREGA.md; ausente = []; id com caminho é recusado", async () => {
    const raiz = mkdtempSync(join(tmpdir(), "entrega-"));
    tmps.push(raiz);
    mkdirSync(join(raiz, "docs/entregas/cobranca"), { recursive: true });
    writeFileSync(join(raiz, "docs/entregas/cobranca/ENTREGA.md"), "---\ncommits:\n  - task: T-1\n    commit: abcdef1\n---\n");
    expect(await lerCommitsDaEntrega(raiz, "cobranca")).toEqual([{ task: "T-1", commit: "abcdef1" }]);
    expect(await lerCommitsDaEntrega(raiz, "inexistente")).toEqual([]);
    expect(await lerCommitsDaEntrega(raiz, "../../etc")).toEqual([]);
  });
});

describe("ENTREGA.md não confiável (A-05)", () => {
  it("symlink para fora do workspace e arquivo gigante não são lidos", async () => {
    const raiz = mkdtempSync(join(tmpdir(), "entrega-sym-"));
    tmps.push(raiz);
    mkdirSync(join(raiz, "docs/entregas/t1"), { recursive: true });
    mkdirSync(join(raiz, "docs/entregas/t2"), { recursive: true });
    const fora = join(raiz, "fora.md");
    writeFileSync(fora, "---\ncommits:\n  - aaaaaaa\npr: 5\n---\n");
    symlinkSync(fora, join(raiz, "docs/entregas/t1/ENTREGA.md"));
    expect(await lerCommitsDaEntrega(raiz, "t1")).toEqual([]);
    expect(await lerPrDaEntrega(raiz, "t1")).toBeNull();
    writeFileSync(join(raiz, "docs/entregas/t2/ENTREGA.md"), `---\ncommits:\n  - bbbbbbb\n---\n${"x".repeat(2 * 1024 * 1024)}`);
    expect(await lerCommitsDaEntrega(raiz, "t2")).toEqual([]);
    mkdirSync(join(raiz, "docs/entregas/ok"), { recursive: true });
    writeFileSync(join(raiz, "docs/entregas/ok/ENTREGA.md"), "---\ncommits:\n  - ccccccc\npr: 8\n---\n");
    expect(await lerCommitsDaEntrega(raiz, "ok")).toEqual([{ task: null, commit: "ccccccc" }]);
    expect(await lerPrDaEntrega(raiz, "ok")).toEqual({ numero: 8, estado: null });
  });
});
