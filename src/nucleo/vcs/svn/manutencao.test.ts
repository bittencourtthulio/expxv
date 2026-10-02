import { describe, expect, it } from "vitest";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as m from "./manutencao";
import { SvnRecusadoErro } from "./comum";
import { chamadas, falso, mensagemGravada } from "../../../../tests/fixtures/vcs/svn-util";
import { pastaTmp } from "../../../../tests/fixtures/vcs/repos";

const cfg = () => {
  const f = falso();
  return { f, cwd: pastaTmp("svn-m-"), op: { executavel: f.executavel, env: f.env } };
};

describe("svn/manutencao: argv seguro", () => {
  it("add/rm/mv/cp/changelist/resolve: alvos depois de `--`, nome com `-` recusado", async () => {
    const { f, cwd, op } = cfg();
    await m.adicionar(cwd, ["a.txt", "-x/b.txt"], op);
    await m.remover(cwd, ["a.txt"], { ...op, manterLocal: true });
    await m.mover(cwd, "a.txt", "c.txt", op);
    await m.copiar(cwd, "a.txt", "d.txt", op);
    await m.definirChangelist(cwd, "minha", ["a.txt"], op);
    await m.removerDeChangelist(cwd, ["a.txt"], op);
    await m.resolver(cwd, ["a.txt"], "theirs-full", op);
    await m.limpar(cwd, op);
    const c = chamadas(f.log);
    expect(c[0]).toEqual(["add", "--non-interactive", "--parents", "--force", "-q", "--", "a.txt", "-x/b.txt"]);
    expect(c[1]).toContain("--keep-local");
    expect(c[2]).toEqual(["mv", "--non-interactive", "--parents", "-q", "--", "a.txt", "c.txt"]);
    expect(c[4]).toEqual(["changelist", "--non-interactive", "-q", "--", "minha", "a.txt"]);
    expect(c[6]).toEqual(["resolve", "--non-interactive", "--accept", "theirs-full", "-q", "--", "a.txt"]);
    expect(c[7]).toEqual(["cleanup", "--non-interactive"]); // nunca --remove-unversioned
    await expect(m.definirChangelist(cwd, "-bad", ["a"], op)).rejects.toThrow();
    await expect(m.resolver(cwd, ["a"], "rm -rf" as never, op)).rejects.toThrow();
    await expect(m.adicionar(cwd, [], op)).rejects.toThrow();
    await expect(m.adicionar(cwd, ["../fora"], op)).rejects.toThrow();
  });
  it("revert exige pasta de segurança (patch recuperável) ou semBackup explícito", async () => {
    const { cwd, op } = cfg();
    await expect(m.reverter(cwd, ["a.txt"], op)).rejects.toBeInstanceOf(SvnRecusadoErro);
    const seg = join(pastaTmp("svn-seg-"), "s");
    const r = await m.reverter(cwd, ["src/f.ts"], { ...op, pastaSeguranca: seg });
    expect(r.backup).not.toBeNull();
    expect(readdirSync(seg)).toHaveLength(1);
    expect(readFileSync(r.backup as string, "utf8")).toContain("Index: novo.txt");
    expect((await m.reverter(cwd, ["a.txt"], { ...op, semBackup: true })).backup).toBeNull();
  });
  it("propset por arquivo temporário (valor nunca em argv); externals externos geram aviso; needs-lock", async () => {
    const { f, cwd, op } = cfg();
    const r = await m.definirPropriedade(cwd, ".", "svn:externals", "^/branches/feature ext\nhttps://example.com/x/y fora\n", op);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toContain("https://example.com/x/y");
    const c = chamadas(f.log).find((x) => x[0] === "propset") as string[];
    expect(c.join(" ")).not.toContain("example.com");
    expect(c).toEqual(expect.arrayContaining(["-F", "svn:externals"]));
    expect(mensagemGravada(f.log)).toContain("https://example.com/x/y");
    await m.definirNeedsLock(cwd, "a.txt", true, op);
    await m.definirNeedsLock(cwd, "a.txt", false, op);
    expect(chamadas(f.log).at(-1)).toEqual(["propdel", "--non-interactive", "-q", "svn:needs-lock", "--", "a.txt"]);
    await expect(m.definirPropriedade(cwd, ".", "-x", "v", op)).rejects.toThrow();
    await expect(m.definirPropriedade(cwd, ".", "a b", "v", op)).rejects.toThrow();
  });
  it("ignorarSvn preserva padrões existentes sem duplicar; lock/unlock gravam no servidor só com confirmação", async () => {
    const { f, cwd, op } = cfg();
    const todos = await m.ignorarSvn(cwd, ".", ["*.log", "*.tmp"], op);
    expect(todos).toEqual(["*.log", "*.tmp"]); // fixture já tinha *.log
    await expect(m.bloquear(cwd, ["a.txt"], { origem: "usuario" }, op)).rejects.toBeInstanceOf(SvnRecusadoErro);
    await expect(m.bloquear(cwd, ["a.txt"], { origem: "automacao", confirmadoServidor: true }, op)).rejects.toBeInstanceOf(SvnRecusadoErro);
    expect(chamadas(f.log).some((x) => x[0] === "lock")).toBe(false);
    await m.bloquear(cwd, ["a.txt"], { origem: "usuario", confirmadoServidor: true, mensagem: "editando" }, op);
    await m.desbloquear(cwd, ["a.txt"], { origem: "usuario", confirmadoServidor: true }, op);
    expect(chamadas(f.log).filter((x) => x[0] === "lock" || x[0] === "unlock")).toHaveLength(2);
    mkdirSync(join(cwd, "x"));
  });
});
