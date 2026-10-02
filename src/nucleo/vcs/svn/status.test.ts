import { describe, expect, it } from "vitest";
import { parseInfoXml } from "./info";
import { parseStatusXml, statusSvn, statusSvnParcial } from "./status";
import { chamadas, falso, lerFixtureSvn } from "../../../../tests/fixtures/vcs/svn-util";
import { pastaTmp } from "../../../../tests/fixtures/vcs/repos";

describe("svn/status: XML gravado", () => {
  const info = parseInfoXml(lerFixtureSvn("info.xml"))[0];
  const s = parseStatusXml(lerFixtureSvn("status.xml"), info);
  const por = (c: string) => s.arquivos.find((m) => m.caminho === c);
  it("mapeia item -> Mudanca (modificado, novo, apagado, não rastreado) e conta", () => {
    expect(por("a.txt")).toBeUndefined(); // a.txt do fixture está limpo; o status gravado tem outros arquivos
    expect(por("novo.txt")).toMatchObject({ tipo: "ordinario", arvore: "A", indice: " ", svn: { changelist: "minha" } });
    expect(por("b.txt")).toMatchObject({ arvore: "D" });
    expect(por("unv.txt")).toMatchObject({ tipo: "naorastreado" });
    expect(por("src/f.ts")).toMatchObject({ arvore: "M", svn: { propriedades: "modified" } });
    expect(por(".")).toMatchObject({ arvore: "M", svn: { propriedades: "modified" } });
    expect(s.branch).toBe("trunk");
    expect(s.oid).toBe("5");
    expect(s.contagens).toMatchObject({ staged: 0, naoRastreados: 1, conflitos: 0 });
    expect(s.contagens.naoStaged).toBeGreaterThanOrEqual(4);
  });
  it("status -u: conflito de texto e itens desatualizados no servidor", () => {
    const u = parseStatusXml(lerFixtureSvn("status-u-conflito.xml"));
    expect(u.arquivos.find((m) => m.caminho === "a.txt")).toMatchObject({ tipo: "conflito", arvore: "U", conflito: "ambos-modificaram" });
    expect(u.contagens.conflitos).toBe(1);
  });
  it("tolerante: XML truncado e vazio não lançam", () => {
    expect(parseStatusXml(lerFixtureSvn("status.xml").slice(0, 700)).arquivos.length).toBeGreaterThanOrEqual(0);
    expect(parseStatusXml("").arquivos).toEqual([]);
  });
});

describe("svn/status: comando", () => {
  it("statusSvn usa --xml e, com servidor, -u; incremental mescla só o caminho", async () => {
    const f = falso();
    const base = { executavel: f.executavel, env: f.env };
    const cwd = pastaTmp("svn-s-");
    const s1 = await statusSvn(cwd, base);
    expect(s1.arquivos.length).toBeGreaterThan(3);
    await statusSvn(cwd, { ...base, servidor: true });
    expect(chamadas(f.log).some((c) => c[0] === "status" && c.includes("-u"))).toBe(true);
    const p = await statusSvnParcial(cwd, s1, ["a.txt"], base);
    expect(p?.parcial).toBe(true);
    expect(chamadas(f.log).at(-1)).toEqual(["status", "--non-interactive", "--xml", "--", "a.txt"]);
    expect(await statusSvnParcial(cwd, { ...s1, estado: "calculando" }, ["a.txt"], base)).toBeNull();
    expect(await statusSvnParcial(cwd, s1, ["../fora"], base)).toBeNull();
    expect(await statusSvnParcial(cwd, s1, Array.from({ length: 60 }, (_, i) => `f${i}`), base)).toBeNull();
  });
});
