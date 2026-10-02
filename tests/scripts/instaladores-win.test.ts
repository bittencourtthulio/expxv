// T-21.09 · Windows: NSIS verificado de forma estática em qualquer SO; o que só roda no CI Windows fica marcado [CI-Windows] (D-26).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PRODUTO } from "../../src/nucleo/produto";
import { lerCabecalhoPE, verificarWindows } from "../../scripts/lib/instaladores.mjs";
import { RAIZ, VERSAO, cli, criarDistWin, pe, tmp } from "./instaladores-ajuda";

const produto = { nome: PRODUTO.nome, id: PRODUTO.id, appId: PRODUTO.appId, prefixoEnv: PRODUTO.prefixoEnv };
type Item = { id: string; ok: boolean; mensagem: string; pulado?: boolean };
const falhas = (itens: Item[]): string[] => itens.filter((i) => !i.ok).map((i) => i.id);

describe("cabeçalho PE", () => {
  it("MZ + PE válidos; assinado só com tabela de certificado; lixo é rejeitado", () => {
    const d = tmp();
    expect(lerCabecalhoPE(pe(join(d, "a.exe")))).toMatchObject({ ok: true, x64: true, assinado: false });
    expect(lerCabecalhoPE(pe(join(d, "b.exe"), { assinado: true }))).toMatchObject({ ok: true, assinado: true });
    expect(lerCabecalhoPE(pe(join(d, "c.exe"), { invalido: true })).ok).toBe(false);
  });
});

describe("verificarWindows (estático)", () => {
  it("dist sintético coerente passa; o nome do instalador deriva de produto.ts", async () => {
    const dist = criarDistWin(tmp());
    const itens: Item[] = await verificarWindows({ dir: dist, produto, versao: VERSAO });
    expect(falhas(itens)).toEqual([]);
    expect(itens.some((i) => i.id === "artefato:setup")).toBe(false);
    expect(itens.find((i) => i.id === "pe:cabecalho")?.mensagem).toContain(`${PRODUTO.nome}-Setup.exe`);
  });

  it("o que só roda no CI Windows aparece marcado [CI-Windows] e pulado", async () => {
    const itens: Item[] = await verificarWindows({ dir: criarDistWin(tmp()), produto, versao: VERSAO });
    const ci = itens.filter((i) => i.id.startsWith("ci-windows:"));
    expect(ci).toHaveLength(3);
    for (const i of ci) {
      expect(i.pulado).toBe(true);
      expect(i.mensagem).toContain("[CI-Windows]");
    }
    expect(ci.map((i) => i.mensagem).join(" ")).toContain("%APPDATA%");
  });

  it("latest.yml adulterado falha no hash", async () => {
    const dist = criarDistWin(tmp(), { adulterar: `${PRODUTO.nome}-Setup.exe` });
    const itens: Item[] = await verificarWindows({ dir: dist, produto, versao: VERSAO });
    expect(falhas(itens)).toEqual([`hash:${PRODUTO.nome}-Setup.exe`]);
  });

  it("nome do instalador fora do derivado de produto.ts falha", async () => {
    const dist = criarDistWin(tmp(), { nome: "Outro-Setup.exe" });
    const itens: Item[] = await verificarWindows({ dir: dist, produto, versao: VERSAO });
    expect(falhas(itens)).toContain("artefato:setup");
    expect(itens.find((i) => i.id === "artefato:setup")?.mensagem).toContain(`${PRODUTO.nome}-Setup.exe`);
  });

  it("PE inválido, blockmap ausente ou incoerente e versão divergente falham pelo item", async () => {
    expect(falhas(await verificarWindows({ dir: criarDistWin(tmp(), { peInvalido: true }), produto, versao: VERSAO }))).toContain("pe:cabecalho");
    expect(falhas(await verificarWindows({ dir: criarDistWin(tmp(), { semBlockmap: true }), produto, versao: VERSAO }))).toEqual([`blockmap:${PRODUTO.nome}-Setup.exe`]);
    expect(falhas(await verificarWindows({ dir: criarDistWin(tmp(), { blockmapRuim: true }), produto, versao: VERSAO }))).toEqual([`blockmap:${PRODUTO.nome}-Setup.exe`]);
    expect(falhas(await verificarWindows({ dir: criarDistWin(tmp(), { versao: "9.9.9" }), produto, versao: VERSAO }))).toEqual(["yml:versao"]);
  });

  it("sem latest.yml o hash NÃO é pulado: falha", async () => {
    const dist = criarDistWin(tmp());
    const itens: Item[] = await verificarWindows({ dir: tmp(), produto, versao: VERSAO });
    expect(falhas(itens)).toContain("hash");
    expect(dist).toBeTruthy();
  });
});

describe("CLI verificar-instaladores (parte Windows)", () => {
  it("passa em dist sintético e falha com yml adulterado", () => {
    const ok = cli("scripts/verificar-instaladores.mjs", [`--dist=${criarDistWin(tmp())}`, "--plataforma=win"]);
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    expect(ok.stdout).toContain("[CI-Windows]");
    const ruim = cli("scripts/verificar-instaladores.mjs", [`--dist=${criarDistWin(tmp(), { adulterar: `${PRODUTO.nome}-Setup.exe` })}`, "--plataforma=win"]);
    expect(ruim.status).toBe(1);
    expect(ruim.stdout).toContain("sha512 difere");
  });

  it("detecta a plataforma pelo yml presente", () => {
    const r = cli("scripts/verificar-instaladores.mjs", [`--dist=${criarDistWin(tmp())}`]);
    expect(r.status).toBe(0);
  });
});

describe("configuração nsis do electron-builder.yml", () => {
  const cfg = parse(readFileSync(join(RAIZ, "electron-builder.yml"), "utf8")) as { nsis?: Record<string, unknown>; win?: { target?: unknown } };

  it("nunca apaga os dados do usuário na desinstalação (deleteAppDataOnUninstall: false, explícito)", () => {
    expect(cfg.nsis?.deleteAppDataOnUninstall).toBe(false);
  });

  it("instalador por usuário, com assistente e nome derivado do produto", () => {
    expect(cfg.nsis?.perMachine).toBe(false);
    expect(cfg.nsis?.oneClick).toBe(false);
    expect(cfg.nsis?.artifactName).toBe(`${PRODUTO.nome}-Setup.\${ext}`);
  });
});
