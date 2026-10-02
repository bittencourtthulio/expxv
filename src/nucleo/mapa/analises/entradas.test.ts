import { describe, expect, it } from "vitest";
import type { Extracao, SimboloBruto } from "../tipos";
import { VERSAO_EXTRATOR } from "../tipos";
import { agregarEntradas, fluxo, normalizarChave, type ArestaFluxoEntrada } from "./entradas";
import type { ArquivoMapa } from "./tipos";

const sim = (qualificado: string, tipo: SimboloBruto["tipo"] = "funcao"): SimboloBruto => ({ nome: qualificado.split(".").pop()!, qualificado, tipo, linha: 1, linha_fim: 2, exportado: true, visibilidade: null, complexidade: 1, assinatura: qualificado, doc: null, decoradores: [] });
const ext = (p: Partial<Extracao>): Extracao => ({ versao_extrator: VERSAO_EXTRATOR, linguagem: "typescript", hash: "h", loc: 1, loc_codigo: 1, loc_comentario: 0, complexidade_total: 0, complexidade_max: 0, erros_parse: 0, e_teste: false, e_gerado: false, truncado: false, simbolos: [], imports: [], chamadas: [], herancas: [], entradas: [], dados: [], padroes: [], dinamicos: [], ...p });
const arq = (caminho: string, p: Partial<Extracao>): ArquivoMapa => ({ caminho, extracao: ext(p) });
const a = (tipo: string, de: string, para: string, confianca: "exata" | "heuristica" = "exata"): ArestaFluxoEntrada => ({ tipo, de, para, confianca });

describe("normalizarChave", () => {
  it.each([
    ["get /users/{id}/", "GET /users/:id"],
    ["POST //a//b", "POST /a/b"],
    ["GET /items/<int:pk>", "GET /items/:pk"],
    ["ipc:canal", "ipc:canal"],
    ["GET /", "GET /"],
  ])("%s", (entrada, esperado) => expect(normalizarChave(entrada)).toBe(esperado));
});

describe("agregarEntradas", () => {
  const arquivos = [
    arq("src/rotas.ts", { simbolos: [sim("listar")], entradas: [{ tipo: "rota", chave: "get /users/{id}", framework: "express", handler: "listar", linha: 3, confianca: "exata" }, { tipo: "rota", chave: "POST /x", framework: "express", handler: "remoto", linha: 4, confianca: "exata" }, { tipo: "rota", chave: "POST /y", framework: "express", handler: null, linha: 5, confianca: "exata" }] }),
    arq("src/h.ts", { simbolos: [sim("remoto")] }),
  ];
  it("liga ao handler: mesmo arquivo exata, nome único heurística, inline vai ao arquivo", () => {
    const r = agregarEntradas(arquivos);
    const por = Object.fromEntries(r.entradas.map((e) => [e.chave, e]));
    expect(por["GET /users/:id"]).toMatchObject({ handler: "sim:src/rotas.ts#listar", confianca: "exata", id: "ent:src/rotas.ts#GET /users/:id" });
    expect(por["POST /x"]).toMatchObject({ handler: "sim:src/h.ts#remoto", confianca: "heuristica" });
    expect(por["POST /y"]?.handler).toBeNull();
    expect(r.arestas.find((x) => x.de.endsWith("POST /y"))?.para).toBe("arq:src/rotas.ts");
    expect(r.arestas.every((x) => x.tipo === "aciona" && x.evidencias?.length === 1)).toBe(true);
    expect(r.porCategoria).toEqual({ rota: 3 });
  });
  it("manifesto (bin, main, scripts) e web.xml", () => {
    const r = agregarEntradas([arq("bin/cli.js", {})], {
      manifestos: [{ caminho: "package.json", bin: { meu: "./bin/cli.js" }, main: "dist/index.js", scripts: { start: "node .", lint: "x" } }],
      webXml: [{ caminho: "WEB-INF/web.xml", texto: "<web-app><servlet><servlet-name>s</servlet-name><servlet-class>com.x.Painel</servlet-class></servlet>\n<servlet-mapping><servlet-name>s</servlet-name><url-pattern>/painel/*</url-pattern></servlet-mapping></web-app>" }],
    });
    const chaves = r.entradas.map((e) => `${e.caminho}|${e.chave}|${e.confianca}`);
    expect(chaves).toContain("bin/cli.js|bin:meu|exata");
    expect(chaves).toContain("package.json|main:dist/index.js|heuristica");
    expect(chaves).toContain("package.json|script:start|exata");
    expect(chaves.some((c) => c.includes("script:lint"))).toBe(false);
    expect(chaves).toContain("WEB-INF/web.xml|ALL /painel/*|exata");
  });
});

describe("fluxo", () => {
  const e = "ent:r.ts#GET /a";
  const g: ArestaFluxoEntrada[] = [
    a("aciona", e, "sim:c.ts#ctrl"),
    a("chama", "sim:c.ts#ctrl", "sim:s.ts#svc"),
    a("chama", "sim:s.ts#svc", "sim:s.ts#repo"),
    a("chama", "sim:s.ts#svc", "sim:s.ts#talvez", "heuristica"),
    a("escreve_tabela", "sim:s.ts#repo", "tab:pedidos"),
    a("le_tabela", "sim:s.ts#repo", "tab:clientes"),
    a("chama", "sim:s.ts#repo", "ext:npm:pg"),
    a("chama", "ext:npm:pg", "sim:nunca#vista"),
    a("chama", "sim:s.ts#repo", "sim:s.ts#svc"), // recursão mútua
    a("importa", "sim:c.ts#ctrl", "sim:ignorado#x"),
  ];
  it("lista os símbolos na ordem das camadas, para em externo, anota tabelas, ramo heurístico e ciclo", () => {
    const f = fluxo(g, e);
    expect(f.nos.map((n) => n.id)).toEqual([e, "sim:c.ts#ctrl", "sim:s.ts#svc", "sim:s.ts#repo", "sim:s.ts#talvez", "ext:npm:pg"]);
    expect(f.nos.map((n) => n.nivel)).toEqual([0, 1, 2, 3, 3, 4]);
    expect(f.tabelas).toEqual(["clientes", "pedidos"]);
    expect(f.nos.find((n) => n.id === "sim:s.ts#repo")?.tabelas).toEqual(["clientes", "pedidos"]);
    expect(f.nos.find((n) => n.id === "sim:s.ts#talvez")?.tracejado).toBe(true);
    expect(f.nos.filter((n) => n.em_ciclo).map((n) => n.id).sort()).toEqual(["sim:s.ts#repo", "sim:s.ts#svc"]);
    expect(f.arestas.filter((x) => x.retorno)).toHaveLength(1);
    expect(f.externos).toEqual(["ext:npm:pg"]);
    expect(f.truncado).toBe(false);
  });
  it("minConfianca exata remove o ramo heurístico", () => {
    expect(fluxo(g, e, { minConfianca: "exata" }).nos.map((n) => n.id)).not.toContain("sim:s.ts#talvez");
  });
  it("trunca em 300 nós e por profundidade", () => {
    const largo: ArestaFluxoEntrada[] = Array.from({ length: 400 }, (_, i) => a("chama", e, `sim:x#f${i}`));
    const f = fluxo(largo, e);
    expect(f.nos).toHaveLength(300);
    expect(f.truncado).toBe(true);
    expect(fluxo(g, e, { profundidade: 1 })).toMatchObject({ truncado: true });
  });
});
