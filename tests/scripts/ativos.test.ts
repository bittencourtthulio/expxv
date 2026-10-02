import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as lerYaml } from "yaml";
import { ATIVOS, copiarAtivos } from "../../scripts/lib/ativos.mjs";

const RAIZ = join(__dirname, "..", "..");

describe("cópia de ativos para dist/", () => {
  it("copia só as extensões pedidas e é idempotente", () => {
    const raiz = mkdtempSync(join(tmpdir(), "ativos-"));
    mkdirSync(join(raiz, "o"), { recursive: true });
    writeFileSync(join(raiz, "o", "a.md"), "a");
    writeFileSync(join(raiz, "o", "b.txt"), "b");
    const ativos = [{ de: "o", para: "d/x", extensoes: [".md"] }];
    expect(copiarAtivos(raiz, ativos)).toEqual([join("d/x", "a.md")]);
    expect(copiarAtivos(raiz, ativos)).toEqual([join("d/x", "a.md")]);
    expect(readFileSync(join(raiz, "d", "x", "a.md"), "utf8")).toBe("a");
    expect(existsSync(join(raiz, "d", "x", "b.txt"))).toBe(false);
  });

  it("origem ausente ou vazia é erro (o build não pode passar sem os ativos)", () => {
    const raiz = mkdtempSync(join(tmpdir(), "ativos-"));
    expect(() => copiarAtivos(raiz, [{ de: "nao-existe", para: "d", extensoes: [".md"] }])).toThrow("ativo ausente");
    mkdirSync(join(raiz, "vazio"));
    expect(() => copiarAtivos(raiz, [{ de: "vazio", para: "d", extensoes: [".md"] }])).toThrow("nenhum ativo");
  });

  it("os ativos reais do repositório existem: os quatro prompts e o gancho.mjs", () => {
    const raiz = mkdtempSync(join(tmpdir(), "ativos-real-"));
    // copia de src/ do repositório para uma raiz temporária: prova o conteúdo sem tocar em dist/
    for (const a of ATIVOS) cpSync(join(RAIZ, a.de), join(raiz, a.de), { recursive: true });
    const copiados = copiarAtivos(raiz);
    for (const nome of ["piloto.md", "worker.md", "revisor.md", "intake.md"]) expect(copiados).toContain(join("dist/nucleo/orquestracao/prompts", nome));
    expect(copiados).toContain(join("dist/nucleo/orquestracao/hooks/scripts", "gancho.mjs"));
  });

  it("scripts/copiar-ativos.mjs roda e deixa os ativos em dist/", () => {
    const r = spawnSync(process.execPath, [join(RAIZ, "scripts", "copiar-ativos.mjs")], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/ativos copiados/);
    expect(existsSync(join(RAIZ, "dist", "nucleo", "orquestracao", "prompts", "piloto.md"))).toBe(true);
    expect(existsSync(join(RAIZ, "dist", "nucleo", "orquestracao", "hooks", "scripts", "gancho.mjs"))).toBe(true);
  });
});

describe("squads de fábrica aninhadas (Fase 14)", () => {
  it("copia recursivamente só json/md, pula arquetipos/, grava 0644 (arquivo) e 0755 (pasta) e é idempotente", () => {
    const raiz = mkdtempSync(join(tmpdir(), "ativos-sq-"));
    for (const d of ["s/a/membros", "s/arquetipos"]) mkdirSync(join(raiz, d), { recursive: true });
    writeFileSync(join(raiz, "s/a/squad.json"), "{}");
    writeFileSync(join(raiz, "s/a/membros/x.md"), "x");
    writeFileSync(join(raiz, "s/a/membros/x.txt"), "no");
    writeFileSync(join(raiz, "s/arquetipos/y.md"), "y");
    writeFileSync(join(raiz, "s/rigor.json"), "{}");
    chmodSync(join(raiz, "s/a/squad.json"), 0o600);
    const ativos = [{ de: "s", para: "dist/sq", extensoes: [".json", ".md"], recursivo: true, ignorar: ["arquetipos"] }];
    const esperado = [join("dist/sq", "a/membros/x.md"), join("dist/sq", "a/squad.json"), join("dist/sq", "rigor.json")].sort();
    expect(copiarAtivos(raiz, ativos).sort()).toEqual(esperado);
    expect(copiarAtivos(raiz, ativos).sort()).toEqual(esperado);
    expect(existsSync(join(raiz, "dist/sq/arquetipos"))).toBe(false);
    expect(existsSync(join(raiz, "dist/sq/a/membros/x.txt"))).toBe(false);
    if (process.platform !== "win32") {
      expect(statSync(join(raiz, "dist/sq/a/squad.json")).mode & 0o777).toBe(0o644);
      expect(statSync(join(raiz, "dist/sq/a/membros")).mode & 0o777).toBe(0o755);
    }
  });

  it("ATIVOS leva resources/squads e o electron-builder as empacota por extraResources, fora do asar e sem os arquétipos", () => {
    const a = ATIVOS.find((x) => x.de === "resources/squads");
    expect(a).toMatchObject({ para: "dist/squads", recursivo: true, ignorar: ["arquetipos"] });
    const cfg = lerYaml(readFileSync(join(RAIZ, "electron-builder.yml"), "utf8")) as { files: string[]; extraResources: Array<{ from: string; to: string; filter?: string[] }> };
    const e = cfg.extraResources.find((x) => x.from === "resources/squads");
    expect(e).toMatchObject({ to: "squads", filter: ["**/*", "!arquetipos/**"] });
    expect(cfg.files).toContain("!dist/squads/**/*");
    expect(cfg.extraResources.filter((x) => x.from === "resources/harness")).toHaveLength(1); // a entrada do harness segue intacta
  });

  it("os arquivos de resources/squads do repositório são legíveis (0644) e as pastas atravessáveis (0755)", () => {
    if (process.platform === "win32") return;
    const andar = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const c = join(dir, n);
        const st = statSync(c);
        if (st.isDirectory()) {
          expect(st.mode & 0o755, c).toBe(0o755);
          andar(c);
        } else expect(st.mode & 0o777, c).toBe(0o644);
      }
    };
    andar(join(RAIZ, "resources", "squads"));
  });
});
