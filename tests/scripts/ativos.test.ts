import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
