import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolverCwd, resolverExecutavel } from "./resolver";

let raiz: string;
let fora: string;
beforeEach(() => {
  raiz = realpathSync(mkdtempSync(join(tmpdir(), "executar-raiz-")));
  fora = realpathSync(mkdtempSync(join(tmpdir(), "executar-fora-")));
});
afterEach(() => { rmSync(raiz, { recursive: true, force: true }); rmSync(fora, { recursive: true, force: true }); });

const exe = (caminho: string, conteudo = "#!/bin/sh\nexit 0\n"): void => { mkdirSync(join(caminho, ".."), { recursive: true }); writeFileSync(caminho, conteudo); chmodSync(caminho, 0o755); };

describe("confusão de cwd e symlink", () => {
  it("cwd dentro do workspace resolve; '.' é a raiz real", () => {
    mkdirSync(join(raiz, "api/src"), { recursive: true });
    expect(resolverCwd(raiz, ".")).toEqual({ ok: true, caminho: raiz });
    expect(resolverCwd(raiz, "api/src")).toEqual({ ok: true, caminho: join(raiz, "api/src") });
  });
  it("recusa .., absoluto, inexistente e arquivo", () => {
    writeFileSync(join(raiz, "a.txt"), "x");
    for (const rel of ["..", "../x", "a/../../x", fora, "nao-existe", "a.txt"]) expect(resolverCwd(raiz, rel).ok, rel).toBe(false);
  });
  it("symlink dentro do workspace apontando para FORA é recusado", () => {
    symlinkSync(fora, join(raiz, "atalho"));
    const r = resolverCwd(raiz, "atalho");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/fora do workspace/);
  });
  it("symlink que fica dentro é aceito", () => {
    mkdirSync(join(raiz, "real"));
    symlinkSync(join(raiz, "real"), join(raiz, "apelido"));
    expect(resolverCwd(raiz, "apelido")).toEqual({ ok: true, caminho: join(raiz, "real") });
  });
  it("raiz inexistente", () => expect(resolverCwd(join(raiz, "sumiu"), ".").ok).toBe(false));
});

describe("resolução de executável", () => {
  it("nome é procurado só no PATH absoluto; entrada relativa/vazia no PATH é ignorada", () => {
    const bin = join(raiz, "bin");
    exe(join(bin, "meuprog"));
    exe(join(raiz, "meuprog")); // plantado na pasta atual: nunca deve ganhar
    const r = resolverExecutavel(raiz, "meuprog", { path: [".", "", "relativo/bin", bin].join(":"), plataforma: "linux" });
    expect(r).toEqual({ ok: true, caminho: join(bin, "meuprog") });
    expect(resolverExecutavel(raiz, "meuprog", { path: ".:", plataforma: "linux" }).ok).toBe(false);
  });
  it("sem permissão de execução não resolve", () => {
    const bin = join(raiz, "bin");
    exe(join(bin, "x"));
    chmodSync(join(bin, "x"), 0o644);
    expect(resolverExecutavel(raiz, "x", { path: bin, plataforma: "linux" }).ok).toBe(false);
  });
  it("caminho relativo é contra a RAIZ e precisa ficar nela", () => {
    exe(join(raiz, "scripts/run.sh"));
    expect(resolverExecutavel(raiz, "./scripts/run.sh")).toEqual({ ok: true, caminho: join(raiz, "scripts/run.sh") });
    expect(resolverExecutavel(raiz, "../x").ok).toBe(false);
    expect(resolverExecutavel(raiz, "/bin/sh").ok).toBe(false);
    expect(resolverExecutavel(raiz, "scripts/nao-existe.sh").ok).toBe(false);
  });
  it("symlink de executável para fora do workspace é recusado", () => {
    exe(join(fora, "ruim.sh"));
    symlinkSync(join(fora, "ruim.sh"), join(raiz, "ruim.sh"));
    const r = resolverExecutavel(raiz, "./ruim.sh");
    expect(r.ok).toBe(false);
  });
});
