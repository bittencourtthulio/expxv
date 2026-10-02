import { describe, expect, it } from "vitest";
import { criarRamoSvn, mergeinfoSvn, mesclarSvn, parseRevisoes, raizDoLocal, reintegrarSvn, trocarSvn } from "./ramos";
import { SvnRecusadoErro } from "./comum";
import { chamadas, falso } from "../../../../tests/fixtures/vcs/svn-util";
import { pastaTmp } from "../../../../tests/fixtures/vcs/repos";

const cfg = () => {
  const f = falso();
  return { f, cwd: pastaTmp("svn-r-"), op: { executavel: f.executavel, env: f.env } };
};
const grav = (f: { log: string }, sub: string) => chamadas(f.log).filter((c) => c[0] === sub);

describe("svn/ramos: criar branch/tag grava no servidor", () => {
  it("simular devolve o plano e NÃO grava (sem confirmação necessária)", async () => {
    const { f, cwd, op } = cfg();
    const p = await criarRamoSvn(cwd, { ...op, tipo: "branch", nome: "feature-x", simular: true });
    expect(p).toMatchObject({ simulado: true, origem: "^/trunk", destino: "^/branches/feature-x", urlDestino: "file:///tmp/gravado/repo/branches/feature-x", revisao: null });
    expect(grav(f, "copy")).toHaveLength(0);
  });
  it("sem confirmadoServidor:true ou sem origem usuario, recusa e nada é gravado", async () => {
    const { f, cwd, op } = cfg();
    await expect(criarRamoSvn(cwd, { ...op, tipo: "branch", nome: "x" })).rejects.toBeInstanceOf(SvnRecusadoErro);
    await expect(criarRamoSvn(cwd, { ...op, tipo: "tag", nome: "x", origem: "usuario" })).rejects.toMatchObject({ motivo: "confirmacao-servidor" });
    await expect(criarRamoSvn(cwd, { ...op, tipo: "tag", nome: "x", origem: "automacao", confirmadoServidor: true })).rejects.toMatchObject({ motivo: "origem-invalida" });
    expect(grav(f, "copy")).toHaveLength(0);
  });
  it("confirmado: svn copy ^/trunk ^/branches/x com mensagem por arquivo; nomes ruins recusados", async () => {
    const { f, cwd, op } = cfg();
    const p = await criarRamoSvn(cwd, { ...op, tipo: "tag", nome: "v1.0", origem: "usuario", confirmadoServidor: true, mensagem: "release ✓" });
    expect(p).toMatchObject({ simulado: false, revisao: 7, destino: "^/tags/v1.0" });
    const c = grav(f, "copy")[0] as string[];
    expect(c.slice(c.indexOf("--") + 1)).toEqual(["^/trunk", "^/tags/v1.0"]);
    expect(c).toEqual(expect.arrayContaining(["-F", "--parents"]));
    for (const nome of ["-r", "../x", "a b", "x;rm", ""]) await expect(criarRamoSvn(cwd, { ...op, tipo: "branch", nome, simular: true })).rejects.toThrow();
  });
  it("raizDoLocal", () => {
    expect(raizDoLocal("^/trunk/sub")).toBe("trunk");
    expect(raizDoLocal("^/branches/x/sub")).toBe("branches/x");
    expect(raizDoLocal("^/foo")).toBeNull();
  });
});

describe("svn/ramos: switch, merge e mergeinfo", () => {
  it("switch por ^/ e --ignore-externals; destino inválido recusado", async () => {
    const { f, cwd, op } = cfg();
    await trocarSvn(cwd, "branches/feature", op);
    const c = grav(f, "switch")[0] as string[];
    expect(c).toEqual(["switch", "--non-interactive", "--accept", "postpone", "--ignore-externals", "--", "^/branches/feature"]);
    await expect(trocarSvn(cwd, "--force", op)).rejects.toThrow();
  });
  it("merge: --accept postpone, simular = --dry-run, mergeinfo elegível/mesclado", async () => {
    const { f, cwd, op } = cfg();
    const r = await mesclarSvn(cwd, { ...op, de: "branches/feature", simular: true });
    expect(r.simulado).toBe(true);
    expect(grav(f, "merge")[0]).toEqual(expect.arrayContaining(["--dry-run", "--accept", "postpone", "^/branches/feature", "."]));
    await mesclarSvn(cwd, { ...op, de: "branches/feature", revisoes: [3, 4] });
    expect(grav(f, "merge")[1]).toEqual(expect.arrayContaining(["-c", "3", "4"]));
    await expect(mesclarSvn(cwd, { ...op, de: "branches/feature", revisoes: [-1] })).rejects.toThrow();
    expect(parseRevisoes("r3\nr4*\nlixo\n")).toEqual([3, 4]);
    expect(await mergeinfoSvn(cwd, "branches/feature", op)).toEqual({ elegiveis: [], mesclados: [] });
  });
  it("reintegrar só no tronco e sem mudanças locais", async () => {
    const { cwd, op } = cfg();
    // o status gravado tem mudanças locais -> recusa (arvore-suja)
    await expect(reintegrarSvn(cwd, { ...op, ramo: "branches/feature" })).rejects.toMatchObject({ motivo: "arvore-suja" });
  });
});
