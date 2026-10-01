import { describe, expect, it } from "vitest";
import { PADRAO_FIXTURES, PREFIXOS_TMP } from "./limpeza";

// AUD-01: a limpeza de órfãos dos testes jamais pode alcançar o daemon/pasta do app real.
describe("limpeza de processos de teste", () => {
  it("só reconhece diretórios temporários dos próprios testes", () => {
    expect([...PREFIXOS_TMP]).toEqual(["ade-e2e-", "ade-dom-"]);
    for (const pre of PREFIXOS_TMP) expect(pre.startsWith("ade-")).toBe(true);
  });

  it("não casa o socket, a pasta de dados nem o daemon do app real", () => {
    const reais = [
      "/var/folders/xx/T/expxv-pty-501/abc.sock",
      "/Users/x/Library/Application Support/expxv/sessoes-pty-v1",
      "/Applications/ExpxV.app/Contents/MacOS/ExpxV dist/daemon/main-daemon.js --dir /Users/x/Library/Application Support/expxv",
    ];
    for (const cmd of reais) {
      expect(PREFIXOS_TMP.some((pre) => cmd.includes(`/T/${pre}`))).toBe(false);
      expect(PADRAO_FIXTURES.test(cmd)).toBe(false);
    }
  });

  it("casa as fixtures de CLI falsa e os diretórios de teste", () => {
    expect(PADRAO_FIXTURES.test("node /x/ExpxDev/tests/fixtures/cli-pty.mjs")).toBe(true);
    expect(PREFIXOS_TMP.some((pre) => "/var/folders/xx/T/ade-e2e-abc/sessoes".includes(`/T/${pre}`))).toBe(true);
  });
});
