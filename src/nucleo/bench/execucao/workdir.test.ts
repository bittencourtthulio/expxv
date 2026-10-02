import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { caminhoRelativoSeguro, criarWorkdir, dentroDeRepositorio, limparRun, listarArtefatos, resolverArtefato } from "./workdir";

const base = realpathSync(mkdtempSync(join(tmpdir(), "bench-wd-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const exec = join(base, "exec");
const e = (alvo: string, fixtures: Record<string, string> = {}, run = "brun_AAAAAAAAAAAA") => ({ raizExec: exec, run, tarefa: "debug-find-and-fix", alvo, fixtures });

describe("workdir descartável", () => {
  it("cria <run>/<tarefa>/<alvo> 0700, copia fixtures e devolve caminho relativo", () => {
    const w = criarWorkdir(e("claude-opus-high", { "soma.js": "x", "sub/dir/a.txt": "y" }));
    expect(w.rel).toBe("brun_AAAAAAAAAAAA/debug-find-and-fix/claude-opus-high");
    expect(readFileSync(join(w.abs, "soma.js"), "utf8")).toBe("x");
    expect(readFileSync(join(w.abs, "sub/dir/a.txt"), "utf8")).toBe("y");
    expect(statSync(w.abs).mode & 0o777).toBe(0o700);
  });
  it("dois alvos da mesma tarefa NÃO compartilham diretório", () => {
    const a = criarWorkdir(e("alvo-a", { "f.txt": "A" }));
    const b = criarWorkdir(e("alvo-b", { "f.txt": "B" }));
    expect(a.abs).not.toBe(b.abs);
    writeFileSync(join(a.abs, "novo.txt"), "só em A");
    expect(existsSync(join(b.abs, "novo.txt"))).toBe(false);
  });
  it("re-run apaga e recria vazio (sem sobras da tentativa anterior)", () => {
    const a = criarWorkdir(e("alvo-r", { "f.txt": "1" }));
    writeFileSync(join(a.abs, "lixo.txt"), "sobra");
    const b = criarWorkdir(e("alvo-r", { "f.txt": "1" }));
    expect(existsSync(join(b.abs, "lixo.txt"))).toBe(false);
    expect(existsSync(join(b.abs, "f.txt"))).toBe(true);
  });
  it("recusa segmentos com .. ou separador e fixture com caminho fora", () => {
    expect(() => criarWorkdir({ ...e("x"), tarefa: ".." })).toThrow();
    expect(() => criarWorkdir({ ...e("x"), alvo: "a/b" })).toThrow();
    expect(() => criarWorkdir(e("fx", { "../fuga.txt": "x" }))).toThrow(/fixture/);
    expect(() => criarWorkdir(e("fx2", { "/abs.txt": "x" }))).toThrow(/fixture/);
  });
  it("um symlink no lugar da pasta é removido como link e nunca seguido", () => {
    const alvoFora = join(base, "fora");
    mkdirSync(alvoFora, { recursive: true });
    writeFileSync(join(alvoFora, "intocado.txt"), "x");
    mkdirSync(join(exec, "brun_SYMLINKAAAA", "debug-find-and-fix"), { recursive: true });
    symlinkSync(alvoFora, join(exec, "brun_SYMLINKAAAA", "debug-find-and-fix", "alvo-s"));
    const w = criarWorkdir(e("alvo-s", {}, "brun_SYMLINKAAAA"));
    expect(existsSync(join(alvoFora, "intocado.txt"))).toBe(true);
    expect(realpathSync(w.abs).startsWith(realpathSync(exec))).toBe(true);
  });
  it("raiz sob um repositório git é recusada", () => {
    const repo = join(base, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    expect(dentroDeRepositorio(join(repo, "sub", "exec"))).toBe(true);
    expect(() => criarWorkdir({ ...e("x"), raizExec: join(repo, "exec") })).toThrow(/repositório/);
    expect(dentroDeRepositorio(exec)).toBe(false);
  });
  it("limparRun remove a pasta da Run e é idempotente", () => {
    criarWorkdir(e("alvo-l", { "a": "1" }, "brun_LIMPARAAAAAA"));
    limparRun(exec, "brun_LIMPARAAAAAA");
    expect(existsSync(join(exec, "brun_LIMPARAAAAAA"))).toBe(false);
    expect(() => limparRun(exec, "brun_LIMPARAAAAAA")).not.toThrow();
    limparRun(exec, "../fora"); // segmento inválido: ignorado
    expect(existsSync(base)).toBe(true);
  });
});

describe("artefatos", () => {
  it("lista sem seguir symlink nem node_modules, com sha256", () => {
    const w = criarWorkdir(e("alvo-art", { "index.html": "<html></html>" }));
    mkdirSync(join(w.abs, "node_modules"), { recursive: true });
    writeFileSync(join(w.abs, "node_modules", "x.js"), "x");
    symlinkSync("/etc/hosts", join(w.abs, "link"));
    const a = listarArtefatos(w.abs);
    expect(a.map((x) => x.nome)).toEqual(["index.html"]);
    expect(a[0]?.sha256).toHaveLength(64);
    expect(a[0]?.tipo).toBe("text/html");
  });
  it("resolverArtefato recusa .., absoluto e symlink", () => {
    const w = criarWorkdir(e("alvo-res", { "ok.txt": "1" }));
    symlinkSync("/etc/hosts", join(w.abs, "hosts"));
    expect(resolverArtefato(w.abs, "ok.txt")).toBe(join(w.abs, "ok.txt"));
    expect(() => resolverArtefato(w.abs, "../x")).toThrow();
    expect(() => resolverArtefato(w.abs, "/etc/hosts")).toThrow();
    expect(() => resolverArtefato(w.abs, "hosts")).toThrow();
    expect(caminhoRelativoSeguro("a/../b")).toBe(false);
  });
});
