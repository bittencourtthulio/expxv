import { describe, expect, it } from "vitest";
import { montarContexto } from "../../../../tests/fixtures/mapa/contexto";
import type { ImportBruto } from "../tipos";
import type { ArquivoParaResolver } from "./comum";
import { includesDeCompileCommands, resolvedorCpp } from "./cpp";

// T-17.18 (C/C++): includes relativos, -I do compile_commands, raiz, convenção, sistema, par .h/.c.

const imp = (especificador: string, linha = 1): ImportBruto => ({ especificador, tipo: "estatico", linha, so_tipo: false, nomes: [] });
function proj(arquivos: Record<string, ImportBruto[]>, textos: Record<string, string> = {}) {
  const mapa = new Map<string, ArquivoParaResolver>();
  for (const [c, imports] of Object.entries(arquivos)) mapa.set(c, { caminho: c, linguagem: c.endsWith(".c") || c.endsWith(".h") ? "c" : "cpp", extracao: { imports, simbolos: [] } });
  return resolvedorCpp.resolver({ arquivos: mapa, manifestos: [], lerTexto: (c) => textos[c] ?? null });
}
const BASE: Record<string, ImportBruto[]> = { "include/loja/base.hpp": [], "include/util.h": [], "src/interno.h": [], "src/a/b.h": [], "libs/x/x.h": [] };
const liga = (arq: string, i: ImportBruto, textos: Record<string, string> = {}) => {
  const r = proj({ ...BASE, [arq]: [i] }, textos);
  return { r, l: r.ligacoes.find((x) => x.arquivo === arq) };
};

describe("resolvedor C/C++: tabela", () => {
  it("relativo ao arquivo é exata", () => expect(liga("src/main.c", imp("interno.h")).l).toMatchObject({ para: "arq:src/interno.h", confianca: "exata" }));
  it("relativo com subpasta", () => expect(liga("src/main.c", imp("a/b.h")).l?.para).toBe("arq:src/a/b.h"));
  it("relativo com ..", () => expect(liga("src/a/y.c", imp("../interno.h")).l?.para).toBe("arq:src/interno.h"));
  it("convenção include/ é heurística", () => expect(liga("src/main.c", imp("loja/base.hpp")).l).toMatchObject({ para: "arq:include/loja/base.hpp", confianca: "heuristica" }));
  it("raiz do projeto é heurística", () => expect(liga("src/main.c", imp("libs/x/x.h")).l).toMatchObject({ para: "arq:libs/x/x.h", confianca: "heuristica" }));
  it("compile_commands -I torna o include exata", () => {
    const cc = JSON.stringify([{ directory: "libs", file: "x.c", arguments: ["cc", "-Ix", "-c", "x.c"] }]);
    expect(liga("src/main.c", imp("x.h"), { "compile_commands.json": cc }).l).toMatchObject({ para: "arq:libs/x/x.h", confianca: "exata" });
  });
  it("compile_commands com `command` string e -isystem", () => {
    const cc = JSON.stringify([{ directory: "/raiz", command: "cc -isystem /raiz/libs/x -c a.c" }]);
    expect(includesDeCompileCommands(cc, "/raiz")).toEqual(["libs/x"]);
  });
  it("-I fora da raiz é ignorado", () => expect(includesDeCompileCommands(JSON.stringify([{ directory: "/outro", arguments: ["cc", "-I/usr/include"] }]), "/raiz")).toEqual([]));
  it("compile_commands inválido não quebra", () => expect(includesDeCompileCommands("{ruim", "/r")).toEqual([]));
  it("<sistema> é externo", () => expect(liga("src/main.c", imp("<stdio.h>")).l?.para).toBe("ext:sistema:stdio.h"));
  it("<x> achado nos -I do projeto é arquivo", () => {
    const cc = JSON.stringify([{ directory: "", arguments: ["cc", "-Ilibs/x"] }]);
    expect(liga("src/main.c", imp("<x.h>"), { "compile_commands.json": cc }).l?.para).toBe("arq:libs/x/x.h");
  });
  it("<x> não é procurado na convenção (continua sistema)", () => expect(liga("src/main.c", imp("<util.h>")).l?.para).toBe("ext:sistema:util.h"));
  it("include de projeto inexistente é listado", () => {
    const { l, r } = liga("src/main.c", imp("nada.h"));
    expect(l?.para).toBeNull();
    expect(r.nao_resolvidos).toHaveLength(1);
  });
  it("include que escapa da raiz é recusado", () => {
    const { r } = liga("src/main.c", imp("/etc/passwd"));
    expect(r.nao_resolvidos[0]?.motivo).toBe("fora_da_raiz");
  });
  it("par .h <-> .c por mesmo nome (heurística), só quando único", () => {
    const r = proj({ "src/foo.c": [], "src/foo.h": [], "src/bar.c": [], "a/bar.h": [], "b/bar.h": [] });
    expect(r.arestas).toEqual([{ de: "arq:src/foo.c", para: "arq:src/foo.h", tipo: "importa", confianca: "heuristica", linha: 1, peso: 1 }]);
  });
  it("par não duplica include explícito (exata prevalece)", () => {
    const r = proj({ "src/foo.c": [imp("foo.h")], "src/foo.h": [] });
    expect(r.arestas).toHaveLength(1);
    expect(r.arestas[0]?.confianca).toBe("exata");
  });
  it("C++ com .hpp e .cpp", () => {
    const r = proj({ "src/p.cpp": [], "include/p.hpp": [] });
    expect(r.arestas[0]?.para).toBe("arq:include/p.hpp");
  });
});

describe("resolvedor C/C++: fixture real", () => {
  it("c/src/banco.c: banco.h por convenção include/, util/log.h ausente, stdlib sistema", async () => {
    const { ctx } = await montarContexto("c");
    const r = resolvedorCpp.resolver(ctx);
    const l = (e: string) => r.ligacoes.find((x) => x.arquivo === "src/banco.c" && x.especificador === e);
    expect(l("banco.h")?.para).toBe("arq:include/banco.h");
    expect(l("util/log.h")?.para).toBeNull();
    expect(l("<stdlib.h>")?.para).toBe("ext:sistema:stdlib.h");
  });
  it("cpp: pedido.cpp inclui loja/pedido.hpp (convenção) e sqlite3 (sistema)", async () => {
    const { ctx } = await montarContexto("cpp");
    const r = resolvedorCpp.resolver(ctx);
    const l = (e: string) => r.ligacoes.find((x) => x.arquivo === "src/pedido.cpp" && x.especificador === e);
    expect(l("loja/pedido.hpp")?.para).toBe("arq:include/loja/pedido.hpp");
    expect(l("<sqlite3.h>")?.para).toBe("ext:sistema:sqlite3.h");
  });
});
