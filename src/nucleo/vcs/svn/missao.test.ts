import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, symlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { listarMissoesSvn, pastaMissaoSvn, removerMissaoSvn, slugMissaoValido, criarMissaoSvn } from "./missao";
import { SvnRecusadoErro } from "./comum";
import { chamadas, falso } from "../../../../tests/fixtures/vcs/svn-util";
import { pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";

const pastas: string[] = [];
afterEach(() => pastas.splice(0).forEach(removerPasta));
const base = (): string => {
  const b = pastaTmp("svn-ms-");
  pastas.push(b);
  mkdirSync(join(b, "proj"));
  return b;
};

describe("svn/missao: cópia de trabalho irmã (sem rede)", () => {
  it("nome da pasta `<repo>--<slug>` e slugs válidos", () => {
    expect(pastaMissaoSvn("/x/proj", "feat-1")).toBe("/x/proj--feat-1");
    for (const s of ["feat", "a-b-c", "m1"]) expect(slugMissaoValido(s)).toBe(true);
    for (const s of ["", "-a", "a--b", "../x", "A", "a b", "a/b", "x".repeat(60)]) expect(slugMissaoValido(s)).toBe(false);
    expect(() => pastaMissaoSvn("/x/proj", "../x")).toThrow(SvnRecusadoErro);
  });
  it("criar faz checkout `--ignore-externals` com URL validada, na pasta irmã; destino existente é recusado", async () => {
    const b = base();
    const f = falso();
    const op = { executavel: f.executavel, env: f.env, permitirFile: true };
    mkdirSync(join(b, "proj", ".svn"));
    await expect(criarMissaoSvn(join(b, "proj"), { ...op, slug: "x" })).rejects.toBeTruthy(); // checkout falso não cria a pasta -> realpath falha
    const c = chamadas(f.log).find((x) => x[0] === "checkout") as string[];
    expect(c).toEqual(["checkout", "--non-interactive", "-q", "--ignore-externals", "--", "file:///tmp/gravado/repo/trunk", join(b, "proj--x")]);
    mkdirSync(join(b, "proj--dup"));
    await expect(criarMissaoSvn(join(b, "proj"), { ...op, slug: "dup" })).rejects.toMatchObject({ motivo: "destino-existe" });
    await expect(criarMissaoSvn(join(b, "proj"), { ...op, slug: "y", alvo: "../outro" })).rejects.toThrow();
    // sem a opção explícita de teste, file:// é recusado
    await expect(criarMissaoSvn(join(b, "proj"), { executavel: f.executavel, env: f.env, slug: "z" })).rejects.toMatchObject({ motivo: "url-invalida" });
  });
  it("listar encontra só irmãs com `.svn`; remover recusa link simbólico e pastas que não são Missão, sem tocar nada", async () => {
    const b = base();
    mkdirSync(join(b, "proj--a", ".svn"), { recursive: true });
    mkdirSync(join(b, "proj--semsvn"));
    mkdirSync(join(b, "outra--a", ".svn"), { recursive: true });
    expect((await listarMissoesSvn(join(b, "proj"))).map((m) => m.slug)).toEqual(["a"]);
    mkdirSync(join(b, "alvo", ".svn"), { recursive: true });
    symlinkSync(join(b, "alvo"), join(b, "proj--link"));
    await expect(removerMissaoSvn(join(b, "proj"), "link", { descartarAlteracoes: true })).rejects.toBeInstanceOf(SvnRecusadoErro);
    expect(existsSync(join(b, "alvo", ".svn"))).toBe(true);
    await expect(removerMissaoSvn(join(b, "proj"), "semsvn", { descartarAlteracoes: true })).rejects.toBeInstanceOf(SvnRecusadoErro);
    expect(existsSync(join(b, "proj--semsvn"))).toBe(true);
    await expect(removerMissaoSvn(join(b, "proj"), "../x")).rejects.toBeInstanceOf(SvnRecusadoErro);
    await removerMissaoSvn(join(b, "proj"), "inexistente");
    // com `.svn` e `descartarAlteracoes`, remove SÓ a pasta (nenhum svn é chamado)
    const f = falso();
    await removerMissaoSvn(join(b, "proj"), "a", { descartarAlteracoes: true, executavel: f.executavel, env: f.env });
    expect(existsSync(join(b, "proj--a"))).toBe(false);
    expect(chamadas(f.log)).toEqual([]);
    expect(existsSync(join(b, "outra--a"))).toBe(true);
  });
});
