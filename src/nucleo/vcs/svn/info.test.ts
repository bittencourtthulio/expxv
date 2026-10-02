import { describe, expect, it } from "vitest";
import { externalsSvn, garantirSvn, infoSvn, layoutDeRaiz, layoutSvn, listarRamosSvn, localAtual, parseExternals, parseInfoXml, parseLs } from "./info";
import { SvnIndisponivelErro } from "./comum";
import { chamadas, falso, lerFixtureSvn } from "../../../../tests/fixtures/vcs/svn-util";
import { pastaTmp } from "../../../../tests/fixtures/vcs/repos";

describe("svn/info: saídas XML gravadas", () => {
  it("parseia info: raiz da cópia, URL, raiz do repositório, revisão, última alteração", () => {
    const i = parseInfoXml(lerFixtureSvn("info.xml"))[0];
    expect(i).toMatchObject({ raizWc: "/tmp/gravado/wc", url: "file:///tmp/gravado/repo/trunk", urlRelativa: "^/trunk", raizRepositorio: "file:///tmp/gravado/repo", revisao: 5, ultimaRevisao: 5, ultimoAutor: "dev", agendamento: "normal", profundidade: "infinity", bloqueio: null });
    expect(i?.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("info com bloqueio (lock) e XML vazio", () => {
    expect(parseInfoXml(lerFixtureSvn("info-lock.xml"))[0]?.bloqueio).toMatchObject({ dono: "dev", comentario: "teste" });
    expect(parseInfoXml("")).toEqual([]);
    expect(parseInfoXml("<info><entry")).toBeTruthy();
  });
  it("layout padrão por `svn ls ^/`, e repositório fora do padrão", () => {
    const l = layoutDeRaiz(parseLs(lerFixtureSvn("ls-raiz.txt")));
    expect(l).toMatchObject({ padrao: true, trunk: "trunk", branches: "branches", tags: "tags" });
    expect(layoutDeRaiz(["src/", "README"])).toMatchObject({ padrao: false, trunk: null });
    expect(localAtual("^/branches/feature/sub")).toEqual({ tipo: "branch", nome: "feature" });
    expect(localAtual("^/tags/v1")).toEqual({ tipo: "tag", nome: "v1" });
    expect(localAtual("^/trunk/x").tipo).toBe("trunk");
    expect(localAtual("^/outro").tipo).toBe("outro");
  });
  it("externals: relativos ao repositório vs FORA do repositório; formatos novo e antigo; com revisão", () => {
    const ext = parseExternals("^/branches/feature ext\nhttps://example.com/x/y fora\n-r2 ^/trunk/src ver\nvelho -r5 https://outro.org/z\n# comentário\n", ".", "file:///tmp/gravado/repo");
    expect(ext.map((e) => [e.destino, e.foraDoRepositorio, e.revisao])).toEqual([
      ["ext", false, null],
      ["fora", true, null],
      ["ver", false, 2],
      ["velho", true, 5],
    ]);
    expect(parseExternals("file:///tmp/gravado/repo/trunk/lib lib", ".", "file:///tmp/gravado/repo")[0]?.foraDoRepositorio).toBe(false);
    expect(parseExternals('"^/a b" "dir com espaço"', ".", "x")[0]).toMatchObject({ url: "^/a b", destino: "dir com espaço" });
  });
});

describe("svn/info: via `svn` falso", () => {
  it("infoSvn/layout/ramos/externals chamam svn com --non-interactive e `--`", async () => {
    const f = falso();
    const base = { executavel: f.executavel, env: f.env };
    const cwd = pastaTmp("svn-i-");
    expect((await infoSvn(cwd, base)).revisao).toBe(5);
    expect((await layoutSvn(cwd, base)).padrao).toBe(true);
    expect(await listarRamosSvn(cwd, "branches", base)).toEqual(["feature"]);
    const ex = await externalsSvn(cwd, base);
    expect(ex.map((e) => e.destino)).toEqual(["ext", "fora", "ver"]);
    expect(ex.every((e) => e.em === "." )).toBe(true);
    expect(ex.filter((e) => e.foraDoRepositorio).map((e) => e.url)).toEqual(["https://example.com/x/y"]);
    for (const c of chamadas(f.log)) expect(c).toContain("--non-interactive");
    expect(chamadas(f.log)[0]).toEqual(["info", "--non-interactive", "--xml", "--", "."]);
  });
  it("svn ausente vira instrução brew install subversion", async () => {
    await expect(garantirSvn({ env: { PATH: "/nao/existe" } })).rejects.toBeInstanceOf(SvnIndisponivelErro);
    await expect(garantirSvn({ env: { PATH: "/nao/existe" } })).rejects.toThrow(/brew install subversion/);
  });
});
