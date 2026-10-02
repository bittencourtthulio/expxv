import { describe, expect, it } from "vitest";
import { proximoCursor, blameSvn, churnDeLog, hotspotsDeChurn, logSvn, paraCommit, parseBlameXml, parseLogXml } from "./historico";
import { chamadas, falso, lerFixtureSvn } from "../../../../tests/fixtures/vcs/svn-util";
import { pastaTmp } from "../../../../tests/fixtures/vcs/repos";

describe("svn/historico: log e blame gravados", () => {
  const es = parseLogXml(lerFixtureSvn("log.xml"));
  it("log -v: revisões, autor, data, mensagem UTF-8 e caminhos com ação", () => {
    expect(es[0]).toMatchObject({ revisao: 6, autor: "dev", mensagem: "segundo ✓ com acento" });
    expect(es[0]?.caminhos.find((c) => c.caminho === "/trunk/b.txt")).toMatchObject({ acao: "D", tipo: "file" });
    const cp = parseLogXml('<log><logentry revision="3"><author>a</author><date>2026-01-01T00:00:00Z</date><paths><path action="A" kind="dir" copyfrom-path="/trunk" copyfrom-rev="2">/branches/f</path></paths><msg>m</msg></logentry></log>')[0]?.caminhos[0];
    expect(cp).toMatchObject({ acao: "A", tipo: "dir", copiadoDe: "/trunk", copiadoRev: 2 });
    expect(paraCommit(es[0] as never)).toMatchObject({ hash: "6", hashCurto: "r6", pais: ["5"], assunto: "segundo ✓ com acento" });
  });
  it("churn e hotspots: função pura sobre o log (prefixo do ramo, diretórios ignorados)", () => {
    const c = churnDeLog(es, { prefixo: "/trunk" });
    const a = c.find((x) => x.caminho === "a.txt");
    expect(a).toMatchObject({ caminho: "a.txt", autores: ["dev"] });
    expect(a?.commits).toBeGreaterThanOrEqual(2);
    expect(c.some((x) => x.caminho === "")).toBe(false);
    expect(c.every((x) => !x.caminho.startsWith("/"))).toBe(true);
    expect(hotspotsDeChurn(c, { topo: 1 })[0]?.caminho).toBe("a.txt");
    expect(churnDeLog(es, { prefixo: "/branches" }).length).toBeGreaterThanOrEqual(0);
    expect(churnDeLog([])).toEqual([]);
  });
  it("blame --xml: revisão por linha", () => {
    const b = parseBlameXml(lerFixtureSvn("blame.xml"));
    expect(b[0]).toMatchObject({ linha: 1, revisao: 2, autor: "dev" });
    expect(b).toHaveLength(3);
  });
});

describe("svn/historico: comandos", () => {
  it("log paginado por -r: cursor = última revisão - 1; fim devolve null", async () => {
    const f = falso();
    const base = { executavel: f.executavel, env: f.env };
    const cwd = pastaTmp("svn-h-");
    const p = await logSvn(cwd, { ...base, limite: 2 });
    expect(p.entradas.length).toBeGreaterThan(0);
    expect(chamadas(f.log)[0]).toEqual(expect.arrayContaining(["log", "--xml", "-v", "-l", "2", "-r", "HEAD:1"]));
    const e = (r: number) => ({ revisao: r, autor: "", data: "", mensagem: "", caminhos: [] });
    expect(proximoCursor([e(9), e(8)], 2)).toBe(7);
    expect(proximoCursor([e(9), e(8)], 5)).toBeNull();
    expect(proximoCursor([e(3), e(2), e(1)], 3)).toBeNull();
    expect((await logSvn(cwd, { ...base, limite: 500 })).proximo).toBeNull();
    await expect(logSvn(cwd, { ...base, desde: -3 as never })).rejects.toThrow();
  });
  it("blameSvn e caminho `-x` com `--`", async () => {
    const f = falso();
    const l = await blameSvn(pastaTmp("svn-h-"), "-x.txt", { executavel: f.executavel, env: f.env });
    expect(l).toHaveLength(3);
    expect(chamadas(f.log)[0]).toEqual(["blame", "--non-interactive", "--xml", "--", "-x.txt"]);
  });
});
