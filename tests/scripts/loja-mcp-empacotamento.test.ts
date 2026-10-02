// Empacotamento da Loja de MCPs (Fase 7B, onda C): o seed, a lista de bloqueio e o lançador `mcp-run.mjs` viajam por extraResources
// (arquivos reais, fora do asar) e o que viaja é válido. Nada aqui instala servidor nem usa rede.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as lerYaml } from "yaml";
import { carregarBloqueio } from "../../src/nucleo/loja-mcp/bloqueio";
import { carregarCatalogo } from "../../src/nucleo/loja-mcp/catalogo";

const RAIZ = join(__dirname, "..", "..");
const cfg = lerYaml(readFileSync(join(RAIZ, "electron-builder.yml"), "utf8")) as { extraResources: Array<{ from: string; to: string; filter?: string[] }>; files: string[]; asarUnpack: string[] };

describe("empacotamento da Loja de MCPs", () => {
  it("resources/mcp vai como extraResources `mcp`, com seed, bloqueio, lançador e locks; a chave `extraResources` aparece uma vez", () => {
    const e = cfg.extraResources.filter((x) => x.from === "resources/mcp");
    expect(e).toHaveLength(1);
    expect(e[0]!.to).toBe("mcp");
    expect(e[0]!.filter).toEqual(expect.arrayContaining(["catalogo-mcps.json", "bloqueio.json", "mcp-run.mjs"]));
    expect(readFileSync(join(RAIZ, "electron-builder.yml"), "utf8").match(/^extraResources:/gm)).toHaveLength(1);
    for (const f of ["catalogo-mcps.json", "bloqueio.json", "mcp-run.mjs"]) expect(existsSync(join(RAIZ, "resources", "mcp", f)), f).toBe(true);
  });

  it("o seed empacotado valida e a lista de bloqueio é aceita (não cai no bloqueio fechado)", () => {
    const cat = carregarCatalogo(join(RAIZ, "resources", "mcp", "catalogo-mcps.json"));
    expect(cat.somente_leitura).toBe(false);
    expect(cat.entradas.length).toBeGreaterThanOrEqual(40);
    expect(carregarBloqueio(join(RAIZ, "resources", "mcp", "bloqueio.json")).consultarId("context7")).toBeNull();
  });

  it("o lançador é um módulo ESM sem dependências (só node:*), sintaticamente válido, e não cita a marca nem segredo", () => {
    const arquivo = join(RAIZ, "resources", "mcp", "mcp-run.mjs");
    expect(statSync(arquivo).isFile()).toBe(true);
    const fonte = readFileSync(arquivo, "utf8");
    const imports = [...fonte.matchAll(/^import\s+[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["node:child_process", "node:http"]);
    expect(fonte).not.toMatch(/expxv/i);
    execFileSync(process.execPath, ["--check", arquivo]);
  });

  it("a thread do MCP não puxa o núcleo da Loja (o que o worker carrega fica no asarUnpack): servidor.ts só vê o tipo da porta", () => {
    const servidor = readFileSync(join(RAIZ, "src", "nucleo", "mcp", "servidor.ts"), "utf8");
    expect(servidor).not.toMatch(/from\s+"\.\.\/loja-mcp/);
    expect(cfg.asarUnpack).toContain("dist/nucleo/mcp/**/*");
  });
});
