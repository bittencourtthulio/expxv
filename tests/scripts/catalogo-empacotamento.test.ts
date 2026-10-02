// Empacotamento do catálogo (Fase 7): skills embarcadas por extraResources, worker de varredura fora do asar e manifesto íntegro. Sem rede.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as lerYaml } from "yaml";
import { textoDoManifesto } from "../../scripts/gerar-manifesto-skills.mjs";

const RAIZ = join(__dirname, "..", "..");
const cfg = lerYaml(readFileSync(join(RAIZ, "electron-builder.yml"), "utf8")) as { extraResources: Array<{ from: string; to: string; filter?: string[] }>; asarUnpack: string[] };

describe("empacotamento do catálogo", () => {
  it("resources/skills vai como extraResources `skills` (uma só chave extraResources) com o manifesto e as ev-*", () => {
    const e = cfg.extraResources.filter((x) => x.from === "resources/skills");
    expect(e).toHaveLength(1);
    expect(e[0]!.to).toBe("skills");
    expect(e[0]!.filter).toEqual(expect.arrayContaining(["manifesto.json"]));
    expect(readFileSync(join(RAIZ, "electron-builder.yml"), "utf8").match(/^extraResources:/gm)).toHaveLength(1);
    expect(existsSync(join(RAIZ, "resources", "skills", "manifesto.json"))).toBe(true);
  });
  it("o manifesto versionado confere com o disco (regerar com scripts/gerar-manifesto-skills.mjs)", () => {
    expect(readFileSync(join(RAIZ, "resources", "skills", "manifesto.json"), "utf8")).toBe(textoDoManifesto(RAIZ));
  });
  it("o worker de varredura e o fecho dele ficam fora do asar", () => {
    const u = cfg.asarUnpack.join("\n");
    for (const a of ["dist/nucleo/catalogo/**/*", "dist/compartilhado/catalogo.js", "dist/nucleo/metodo/**/*", "dist/nucleo/produto.js", "node_modules/yaml/**/*"]) expect(u, a).toContain(a);
  });
});
