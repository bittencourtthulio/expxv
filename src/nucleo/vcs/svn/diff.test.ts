import { describe, expect, it } from "vitest";
import { converterDiffSvn, diffSvn } from "./diff";
import { chamadas, falso, lerFixtureSvn } from "../../../../tests/fixtures/vcs/svn-util";
import { pastaTmp, escrever } from "../../../../tests/fixtures/vcs/repos";

describe("svn/diff: formato Index: -> parser da 6A", () => {
  const d = converterDiffSvn(lerFixtureSvn("diff.txt"));
  it("arquivos novo/modificado e o diff de PROPRIEDADE (needs-lock, ignore) aparecem", async () => {
    const f = falso();
    const r = await diffSvn(pastaTmp("svn-d-"), { executavel: f.executavel, env: f.env });
    const por = Object.fromEntries(r.arquivos.map((a) => [a.caminho, a]));
    expect(por["novo.txt"]).toMatchObject({ estado: "novo", insercoes: 1 });
    expect(por["src/f.ts"]).toMatchObject({ estado: "modificado", insercoes: 1, delecoes: 0 });
    expect(r.propriedades.map((p) => [p.caminho, p.nome, p.acao, p.novo])).toEqual([
      ["bin.dat", "svn:mime-type", "adicionada", "application/octet-stream"],
      ["src/f.ts", "svn:needs-lock", "adicionada", "*"],
      [".", "svn:ignore", "adicionada", "*.log"],
    ]);
    expect(d.propriedades).toHaveLength(3);
    expect(chamadas(f.log)[0]).toContain("--internal-diff");
  });
  it("apagado, binário e propriedade modificada", () => {
    const t = [
      "Index: b.txt", "===", "--- b.txt\t(revision 2)", "+++ b.txt\t(nonexistent)", "@@ -1 +0,0 @@", "-dois",
      "Index: bin.dat", "===", "Cannot display: file marked as a binary type.", "svn:mime-type = application/octet-stream", "",
      "Property changes on: .", "___", "Modified: svn:ignore", "## -1 +1,2 ##", "-*.o", "+*.o", "+*.log", "",
    ].join("\n");
    const r = converterDiffSvn(t);
    expect(r.git).toContain("deleted file mode");
    expect(r.git).toContain("Binary files a/bin.dat and b/bin.dat differ");
    expect(r.propriedades[0]).toMatchObject({ acao: "modificada", antigo: "*.o", novo: "*.o\n*.log" });
  });
  it("nunca lança com lixo; arquivo não rastreado vira diff 'novo'; base/contexto validados", async () => {
    expect(() => converterDiffSvn("lixo\n@@ x\n+y")).not.toThrow();
    const dir = pastaTmp("svn-d-");
    escrever(dir, "u.txt", "a\nb\n");
    const r = await diffSvn(dir, { naoRastreado: true, caminho: "u.txt" });
    expect(r.arquivos[0]).toMatchObject({ estado: "novo", insercoes: 2 });
    await expect(diffSvn(dir, { base: "-x" })).rejects.toThrow();
    await expect(diffSvn(dir, { contexto: -1 })).rejects.toThrow();
    await expect(diffSvn(dir, { naoRastreado: true, caminho: "../x" })).rejects.toThrow();
  });
});
