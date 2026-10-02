import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compararManifestos, copiarBackup, criarManifesto, limparCriados } from "./manifesto";

let raiz: string;
let fora: string;
beforeEach(() => { raiz = mkdtempSync(join(tmpdir(), "suite-man-")); fora = mkdtempSync(join(tmpdir(), "suite-fora-")); });
afterEach(() => { rmSync(raiz, { recursive: true, force: true }); rmSync(fora, { recursive: true, force: true }); });
const w = (rel: string, txt = "x"): void => { mkdirSync(join(raiz, rel, ".."), { recursive: true }); writeFileSync(join(raiz, rel), txt); };

describe("manifesto e diff de árvore", () => {
  it("lista criados, alterados e removidos; ignora node_modules", async () => {
    w(".claude/settings.json", "a"); w(".claude/velho.md", "v"); w("node_modules/x/y.js", "n");
    const antes = await criarManifesto(raiz);
    expect([...antes.mapa.keys()].some((k) => k.includes("node_modules/x"))).toBe(false);
    w(".claude/settings.json", "b"); rmSync(join(raiz, ".claude/velho.md")); w(".claude/skills/runx/SKILL.md"); w(".expx/expx-lock.json");
    const d = compararManifestos(antes.mapa, (await criarManifesto(raiz)).mapa);
    expect(d.criados).toEqual([".claude/skills/runx/SKILL.md", ".expx/expx-lock.json"]);
    expect(d.alterados).toEqual([".claude/settings.json"]);
    expect(d.removidos).toEqual([".claude/velho.md"]);
    expect(d.fora_do_esperado).toEqual([]);
  });

  it("mudança fora de .claude/.expx/.opencode vira 'fora do esperado'", async () => {
    w("README.md", "a");
    const antes = await criarManifesto(raiz);
    w("README.md", "b"); w("novo.txt"); mkdirSync(join(raiz, "pasta-nova"));
    const d = compararManifestos(antes.mapa, (await criarManifesto(raiz)).mapa);
    expect(d.fora_do_esperado).toEqual(["README.md", "novo.txt", "pasta-nova"]);
  });

  it("não segue symlink (o alvo fora da raiz não entra)", async () => {
    writeFileSync(join(fora, "segredo.txt"), "s");
    mkdirSync(join(raiz, ".claude"), { recursive: true });
    symlinkSync(fora, join(raiz, ".claude", "atalho"));
    const m = (await criarManifesto(raiz)).mapa;
    expect(m.get(".claude/atalho")?.tipo).toBe("link");
    expect([...m.keys()].some((k) => k.includes("segredo"))).toBe(false);
  });
});

describe("cópia de segurança e limpeza segura", () => {
  it("copia só arquivos pré-existentes das pastas gravadas e restaura o alterado", async () => {
    w(".claude/settings.json", "original"); w("README.md", "r");
    const antes = await criarManifesto(raiz);
    const bk = join(fora, "bk");
    const b = await copiarBackup(raiz, antes.mapa, bk);
    expect(b.copiados).toBe(1);
    expect(existsSync(join(bk, "README.md"))).toBe(false);
    // instalação pela metade: altera um, cria outros
    w(".claude/settings.json", "mexido"); w(".claude/skills/runx/SKILL.md"); w(".expx/expx-lock.json"); w(".opencode/commands/a.md");
    const depois = await criarManifesto(raiz);
    const r = await limparCriados(raiz, antes.mapa, depois.mapa, bk);
    expect(r).toEqual({ removidos: 3, restaurados: 1, restantes: [] });
    expect(readFileSync(join(raiz, ".claude/settings.json"), "utf8")).toBe("original");
    expect(existsSync(join(raiz, ".expx"))).toBe(false);
    expect(existsSync(join(raiz, ".opencode"))).toBe(false);
    expect(existsSync(join(raiz, ".claude/skills"))).toBe(false);
    expect(existsSync(join(raiz, ".claude"))).toBe(true); // já existia
  });

  it("alterado SEM cópia nunca é apagado: vai para 'restantes'", async () => {
    w(".claude/settings.json", "original");
    const antes = await criarManifesto(raiz);
    w(".claude/settings.json", "mexido");
    const r = await limparCriados(raiz, antes.mapa, (await criarManifesto(raiz)).mapa, null);
    expect(r.restantes).toEqual([".claude/settings.json"]);
    expect(readFileSync(join(raiz, ".claude/settings.json"), "utf8")).toBe("mexido");
  });

  it("arquivo do usuário criado FORA das pastas gravadas nunca é removido", async () => {
    const antes = await criarManifesto(raiz);
    w("meu-arquivo.txt", "meu"); w(".claude/novo.md");
    const r = await limparCriados(raiz, antes.mapa, (await criarManifesto(raiz)).mapa, null);
    expect(r.removidos).toBe(1);
    expect(existsSync(join(raiz, "meu-arquivo.txt"))).toBe(true);
  });

  it("symlink criado dentro da pasta é removido sem tocar no alvo", async () => {
    writeFileSync(join(fora, "alvo.txt"), "alvo");
    const antes = await criarManifesto(raiz);
    mkdirSync(join(raiz, ".claude"), { recursive: true });
    symlinkSync(join(fora, "alvo.txt"), join(raiz, ".claude", "link.txt"));
    await limparCriados(raiz, antes.mapa, (await criarManifesto(raiz)).mapa, null);
    expect(existsSync(join(fora, "alvo.txt"))).toBe(true);
    expect(existsSync(join(raiz, ".claude", "link.txt"))).toBe(false);
  });
});
