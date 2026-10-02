// D-141: manifesto sha256 do seed da Loja de MCPs, gerado no build e conferido pelo main (AC-14: seed adulterado ⇒ Loja só leitura).
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as lerYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { conferirManifestoMcp, gerarManifestoMcp, MANIFESTO_MCP, SEED_MCP } from "../../scripts/lib/manifesto-mcp.mjs";
import { carregarCatalogo } from "../../src/nucleo/loja-mcp/catalogo";

const RAIZ = join(__dirname, "..", "..");

function raizComSeed(): string {
  const raiz = mkdtempSync(join(tmpdir(), "manifesto-mcp-"));
  mkdirSync(join(raiz, "resources", "mcp"), { recursive: true });
  copyFileSync(join(RAIZ, SEED_MCP), join(raiz, SEED_MCP));
  return raiz;
}
const hashDoManifesto = (raiz: string): string => readFileSync(join(raiz, MANIFESTO_MCP), "utf8").trim().split(/\s+/)[0]!;

describe("manifesto do seed da Loja de MCPs", () => {
  it("gera `<sha256>  catalogo-mcps.json`, é idempotente e confere como ok", () => {
    const raiz = raizComSeed();
    expect(conferirManifestoMcp(raiz)).toBe("ausente");
    const h = gerarManifestoMcp(raiz);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(raiz, MANIFESTO_MCP), "utf8")).toBe(`${h}  catalogo-mcps.json\n`);
    expect(gerarManifestoMcp(raiz)).toBe(h);
    expect(conferirManifestoMcp(raiz)).toBe("ok");
  });

  it("seed ausente é erro (o build não passa sem catálogo)", () => {
    expect(() => gerarManifestoMcp(mkdtempSync(join(tmpdir(), "manifesto-vazio-")))).toThrow(/ausente/);
  });

  it("um byte alterado no seed empacotado: conferir diz adulterado e o carregador abre SÓ em leitura, nada instalável", () => {
    const raiz = raizComSeed();
    gerarManifestoMcp(raiz);
    const seed = join(raiz, SEED_MCP);
    const bom = carregarCatalogo(seed, { sha256Esperado: hashDoManifesto(raiz) });
    expect(bom.somente_leitura).toBe(false);
    expect(bom.entradas.some((e) => e.instalavel)).toBe(true);
    // altera um byte sem quebrar o JSON (espaço ao final)
    writeFileSync(seed, `${readFileSync(seed, "utf8")}\n `);
    expect(conferirManifestoMcp(raiz)).toBe("adulterado");
    const ruim = carregarCatalogo(seed, { sha256Esperado: hashDoManifesto(raiz) });
    expect(ruim.somente_leitura).toBe(true);
    expect(ruim.aviso).toMatch(/adulterado/);
    expect(ruim.entradas.every((e) => !e.instalavel && e.motivo_nao_instalavel === "catalogo_adulterado")).toBe(true);
  });

  it("manifesto malformado conta como adulterado (falha fechada)", () => {
    const raiz = raizComSeed();
    writeFileSync(join(raiz, MANIFESTO_MCP), "nao-e-hash\n");
    expect(conferirManifestoMcp(raiz)).toBe("adulterado");
  });

  it("o pacote leva o manifesto por extraResources e ele fica fora do git (artefato de build)", () => {
    const cfg = lerYaml(readFileSync(join(RAIZ, "electron-builder.yml"), "utf8")) as { extraResources: Array<{ from: string; filter?: string[] }> };
    expect(cfg.extraResources.find((x) => x.from === "resources/mcp")?.filter).toContain("catalogo-mcps.json.sha256");
    expect(readFileSync(join(RAIZ, ".gitignore"), "utf8")).toContain("resources/mcp/catalogo-mcps.json.sha256");
  });
});
