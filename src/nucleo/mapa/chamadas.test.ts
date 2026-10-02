import { describe, expect, it } from "vitest";
import { resolverChamadas, STOPLIST_PADRAO, type ArestaSimbolo, type ResultadoChamadas } from "./chamadas";
import { extrairArquivo } from "./extratores/registro";
import { detectarLinguagem } from "./linguagens";
import { resolverTodos, type ArquivoParaResolver } from "./resolucao/comum";
import { resolvedorGo } from "./resolucao/go";
import { resolvedorJava } from "./resolucao/java";
import { resolvedorPython } from "./resolucao/python";
import { resolvedorTs } from "./resolucao/ts";

// T-17.19: ≥ 30 casos em tabela, com extração e resolução REAIS (TS, Python, Java, Go) em projetos de memória.
// Regras: nenhuma aresta `exata` sem prova (escopo/import); cada `heuristica` traz `candidatos`.

async function rodar(fontes: Record<string, string>): Promise<{ r: ResultadoChamadas; arestas: ArestaSimbolo[] }> {
  const arquivos = new Map<string, ArquivoParaResolver>();
  for (const [c, t] of Object.entries(fontes)) {
    const ling = detectarLinguagem(c, t.split("\n")[0]);
    if (ling === null) throw new Error(`linguagem de ${c}`);
    arquivos.set(c, { caminho: c, linguagem: ling, extracao: await extrairArquivo(t, ling, c) });
  }
  const res = resolverTodos([resolvedorTs, resolvedorPython, resolvedorJava, resolvedorGo], { arquivos, manifestos: [] });
  const r = resolverChamadas({ arquivos, ligacoes: res.ligacoes });
  return { r, arestas: r.arestas };
}

const acha = (as: ArestaSimbolo[], de: string, para: string, tipo: ArestaSimbolo["tipo"] = "chama") => as.find((a) => a.tipo === tipo && a.de === de && a.para === para);

describe("resolverChamadas: TypeScript (escopo, import, receptor)", () => {
  it("1. escopo local: chamada a função do mesmo arquivo é exata", async () => {
    const { arestas } = await rodar({ "a.ts": "function f() { g(); }\nfunction g() {}\n" });
    expect(acha(arestas, "sim:a.ts#f", "sim:a.ts#g")?.confianca).toBe("exata");
  });
  it("2. recursão gera aresta para si mesmo, exata", async () => {
    const { arestas } = await rodar({ "a.ts": "function f(n: number): number { return n ? f(n - 1) : 0; }\n" });
    expect(acha(arestas, "sim:a.ts#f", "sim:a.ts#f")?.confianca).toBe("exata");
  });
  it("3. função aninhada vê a do pai", async () => {
    const { arestas } = await rodar({ "a.ts": "function f() { function h() {} function k() { h(); } }\n" });
    expect(acha(arestas, "sim:a.ts#f.k", "sim:a.ts#f.h")?.confianca).toBe("exata");
  });
  it("4. binding de import nomeado -> símbolo exportado do arquivo-alvo (exata)", async () => {
    const { arestas } = await rodar({ "a.ts": 'import { g } from "./b";\nexport function f() { g(); }\n', "b.ts": "export function g() {}\n" });
    expect(acha(arestas, "sim:a.ts#f", "sim:b.ts#g")?.confianca).toBe("exata");
  });
  it("5. import com alias", async () => {
    const { arestas } = await rodar({ "a.ts": 'import { g as h } from "./b";\nexport function f() { h(); }\n', "b.ts": "export function g() {}\n" });
    expect(acha(arestas, "sim:a.ts#f", "sim:b.ts#g")?.confianca).toBe("exata");
  });
  it("6. re-export em cadeia (barrel) segue até o símbolo", async () => {
    const { arestas } = await rodar({
      "a.ts": 'import { g } from "./barrel";\nexport function f() { g(); }\n',
      "barrel.ts": 'export * from "./meio";\n',
      "meio.ts": 'export { g } from "./b";\n',
      "b.ts": "export function g() {}\n",
    });
    expect(acha(arestas, "sim:a.ts#f", "sim:b.ts#g")?.confianca).toBe("exata");
  });
  it("7. import default", async () => {
    const { arestas } = await rodar({ "a.ts": 'import tudo from "./b";\nexport function f() { tudo(); }\n', "b.ts": "export default function tudo() {}\n" });
    const a = arestas.find((x) => x.de === "sim:a.ts#f");
    expect(a).toBeDefined();
    expect(a?.para.startsWith("sim:b.ts#")).toBe(true);
  });
  it("8. namespace import: ns.fn()", async () => {
    const { arestas } = await rodar({ "a.ts": 'import * as u from "./b";\nexport function f() { u.g(); }\n', "b.ts": "export function g() {}\n" });
    expect(acha(arestas, "sim:a.ts#f", "sim:b.ts#g")?.confianca).toBe("exata");
  });
  it("9. classe importada: Classe.metodoEstatico()", async () => {
    const { arestas } = await rodar({ "a.ts": 'import { C } from "./b";\nexport function f() { C.criar(); }\n', "b.ts": "export class C { static criar() {} }\n" });
    expect(acha(arestas, "sim:a.ts#f", "sim:b.ts#C.criar")?.confianca).toBe("exata");
  });
  it("10. new Classe() liga `instancia` (exata)", async () => {
    const { arestas } = await rodar({ "a.ts": 'import { C } from "./b";\nexport function f() { return new C(); }\n', "b.ts": "export class C {}\n" });
    expect(acha(arestas, "sim:a.ts#f", "sim:b.ts#C", "instancia")?.confianca).toBe("exata");
  });
  it("11. this.metodo() na própria classe", async () => {
    const { arestas } = await rodar({ "a.ts": "export class S { a() { this.b(); } b() {} }\n" });
    expect(acha(arestas, "sim:a.ts#S.a", "sim:a.ts#S.b")?.confianca).toBe("exata");
  });
  it("12. this.metodo() herdado da base importada", async () => {
    const { arestas } = await rodar({ "a.ts": 'import { Base } from "./b";\nexport class S extends Base { a() { this.base(); } }\n', "b.ts": "export class Base { base() {} }\n" });
    expect(acha(arestas, "sim:a.ts#S.a", "sim:b.ts#Base.base")?.confianca).toBe("exata");
  });
  it("13. super.metodo() resolve na base, nunca na própria classe", async () => {
    const { arestas } = await rodar({ "a.ts": 'import { Base } from "./b";\nexport class S extends Base { run2() { super.run2(); } }\n', "b.ts": "export class Base { run2() {} }\n" });
    expect(acha(arestas, "sim:a.ts#S.run2", "sim:b.ts#Base.run2")?.confianca).toBe("exata");
    expect(acha(arestas, "sim:a.ts#S.run2", "sim:a.ts#S.run2")).toBeUndefined();
  });
  it("14. método de classe NÃO é chamável sem receptor em TS (cai em nome, não em escopo)", async () => {
    const { arestas } = await rodar({ "a.ts": "export class S { a() { helper(); } helper() {} }\n" });
    const a = acha(arestas, "sim:a.ts#S.a", "sim:a.ts#S.helper");
    expect(a?.confianca).toBe("heuristica");
    expect(a?.candidatos).toBe(1);
  });
  it("15. homônimos em arquivos distintos: import desambigua (exata, 1 aresta)", async () => {
    const { arestas } = await rodar({
      "a.ts": 'import { dup } from "./x";\nexport function f() { dup(); }\n',
      "x.ts": "export function dup() {}\n",
      "y.ts": "export function dup() {}\n",
    });
    const as = arestas.filter((e) => e.de === "sim:a.ts#f");
    expect(as).toHaveLength(1);
    expect(as[0]).toMatchObject({ para: "sim:x.ts#dup", confianca: "exata" });
  });
  it("16. receptor desconhecido: método único no projeto -> heurística candidatos=1", async () => {
    const { arestas } = await rodar({ "a.ts": "export function f(o: any) { o.sincronizar(); }\n", "b.ts": "export class S { sincronizar() {} }\n" });
    const a = acha(arestas, "sim:a.ts#f", "sim:b.ts#S.sincronizar");
    expect(a).toMatchObject({ confianca: "heuristica", candidatos: 1 });
  });
  it("17. 2 a 5 candidatos: uma aresta por candidato, todas heurísticas com candidatos=n", async () => {
    const { arestas } = await rodar({
      "a.ts": "export function f(o: any) { o.enviar(); }\n",
      "b.ts": "export class A { enviar() {} }\n",
      "c.ts": "export class B { enviar() {} }\n",
      "d.ts": "export class C { enviar() {} }\n",
    });
    const as = arestas.filter((e) => e.de === "sim:a.ts#f");
    expect(as).toHaveLength(3);
    expect(as.every((e) => e.confianca === "heuristica" && e.candidatos === 3)).toBe(true);
  });
  it("18. mais de 5 candidatos: descartado e contado em chamadas_ambiguas", async () => {
    const fontes: Record<string, string> = { "a.ts": "export function f(o: any) { o.enviar(); }\n" };
    for (let i = 0; i < 6; i++) fontes[`c${i}.ts`] = `export class K${i} { enviar() {} }\n`;
    const { r, arestas } = await rodar(fontes);
    expect(arestas.filter((e) => e.de === "sim:a.ts#f")).toEqual([]);
    expect(r.chamadas_ambiguas).toBe(1);
  });
  it("19. stoplist: `get`/`map` genéricos nunca resolvem só por nome", async () => {
    const { r, arestas } = await rodar({ "a.ts": "export function f(o: any) { o.get(); o.map(); }\n", "b.ts": "export class S { get() {} map() {} }\n" });
    expect(arestas.filter((e) => e.de === "sim:a.ts#f")).toEqual([]);
    expect(r.descartadas_stoplist).toBe(2);
    expect(STOPLIST_PADRAO.has("toString")).toBe(true);
  });
  it("20. stoplist não impede resolução EXATA do mesmo nome (get importado)", async () => {
    const { arestas } = await rodar({ "a.ts": 'import { get } from "./b";\nexport function f() { get(); }\n', "b.ts": "export function get() {}\n" });
    expect(acha(arestas, "sim:a.ts#f", "sim:b.ts#get")?.confianca).toBe("exata");
  });
  it("21. chamada a pacote externo importado liga ao nó externo (exata)", async () => {
    const { arestas } = await rodar({ "a.ts": 'import { render } from "react-dom";\nexport function f() { render(); }\n' });
    expect(acha(arestas, "sim:a.ts#f", "ext:npm:react-dom")?.confianca).toBe("exata");
  });
  it("22. chamada no topo do arquivo parte do nó do arquivo", async () => {
    const { arestas } = await rodar({ "a.ts": "function g() {}\ng();\n" });
    expect(acha(arestas, "arq:a.ts", "sim:a.ts#g")?.confianca).toBe("exata");
  });
  it("23. API embutida sem alvo no projeto não gera aresta e é contada em sem_alvo", async () => {
    const { r, arestas } = await rodar({ "a.ts": "export function f() { fetch('x'); }\n" });
    expect(arestas).toEqual([]);
    expect(r.sem_alvo).toBe(1);
  });
  it("24. herança: extends resolvido pelo import (exata); implements de interface", async () => {
    const { arestas } = await rodar({
      "a.ts": 'import { Base, Iface } from "./b";\nexport class S extends Base implements Iface {}\n',
      "b.ts": "export class Base {}\nexport interface Iface {}\n",
    });
    expect(acha(arestas, "sim:a.ts#S", "sim:b.ts#Base", "herda")?.confianca).toBe("exata");
    expect(acha(arestas, "sim:a.ts#S", "sim:b.ts#Iface", "implementa")?.confianca).toBe("exata");
  });
  it("25. método de interface liga também às implementações (via_interface, heurística)", async () => {
    const { arestas } = await rodar({
      "a.ts": 'import { Repo } from "./b";\nexport function f(r: Repo) { Repo.salvar(); }\n',
      "b.ts": "export interface Repo { salvar(): void }\nexport class RepoImpl implements Repo { salvar() {} }\n",
    });
    const via = arestas.find((e) => e.via_interface);
    expect(via).toMatchObject({ para: "sim:b.ts#RepoImpl.salvar", confianca: "heuristica" });
    expect(via?.candidatos).toBe(1);
  });
  it("26. invariante: toda aresta `exata` tem de ser provada; toda `heuristica` de nome traz candidatos", async () => {
    const { arestas } = await rodar({
      "a.ts": 'import { g } from "./b";\nexport function f(o: any) { g(); o.zzz(); o.enviar(); }\n',
      "b.ts": "export function g() {}\nexport class K { enviar() {} zzz() {} }\n",
    });
    for (const e of arestas) {
      if (e.confianca === "heuristica") expect(e.candidatos).not.toBeNull();
      else expect(e.candidatos).toBeNull();
    }
  });
  it("27. evidências: até 5 `arquivo:linha`, peso soma ocorrências", async () => {
    const src = "function g() {}\nexport function f() {\n" + Array.from({ length: 8 }, () => "  g();\n").join("") + "}\n";
    const { arestas } = await rodar({ "a.ts": src });
    const e = acha(arestas, "sim:a.ts#f", "sim:a.ts#g");
    expect(e?.peso).toBe(8);
    expect(e?.evidencias).toHaveLength(5);
    expect(e?.evidencias[0]).toMatch(/^a\.ts:\d+$/);
  });
  it("28. determinismo: duas execuções dão as mesmas arestas", async () => {
    const f = { "a.ts": 'import { g } from "./b";\nexport function f(o: any) { g(); o.enviar(); }\n', "b.ts": "export function g() {}\nexport class K { enviar() {} }\n" };
    expect((await rodar(f)).arestas).toEqual((await rodar(f)).arestas);
  });
});

describe("resolverChamadas: outras linguagens", () => {
  it("29. Python: from x import f; chamada exata", async () => {
    const { arestas } = await rodar({ "app/a.py": "from app.b import g\n\ndef f():\n    g()\n", "app/b.py": "def g():\n    pass\n", "app/__init__.py": "" });
    expect(acha(arestas, "sim:app/a.py#f", "sim:app/b.py#g")?.confianca).toBe("exata");
  });
  it("30. Python: import modulo; modulo.fn()", async () => {
    const { arestas } = await rodar({ "app/a.py": "from app import b\n\ndef f():\n    b.g()\n", "app/b.py": "def g():\n    pass\n", "app/__init__.py": "" });
    expect(acha(arestas, "sim:app/a.py#f", "sim:app/b.py#g")).toBeDefined();
  });
  it("31. Python: self.metodo() na classe", async () => {
    const { arestas } = await rodar({ "a.py": "class S:\n    def a(self):\n        self.b()\n    def b(self):\n        pass\n" });
    expect(acha(arestas, "sim:a.py#S.a", "sim:a.py#S.b")?.confianca).toBe("exata");
  });
  it("32. Java: import FQN + Classe.metodoEstatico()", async () => {
    const { arestas } = await rodar({
      "src/main/java/br/app/web/C.java": "package br.app.web;\nimport br.app.util.Fmt;\npublic class C { void m() { Fmt.formatar(); } }\n",
      "src/main/java/br/app/util/Fmt.java": "package br.app.util;\npublic class Fmt { public static String formatar() { return \"\"; } }\n",
    });
    expect(acha(arestas, "sim:src/main/java/br/app/web/C.java#C.m", "sim:src/main/java/br/app/util/Fmt.java#Fmt.formatar")?.confianca).toBe("exata");
  });
  it("33. Java: chamada de método da própria classe sem receptor (classe implícita)", async () => {
    const { arestas } = await rodar({ "src/main/java/p/A.java": "package p;\npublic class A { void a() { b(); } void b() {} }\n" });
    expect(acha(arestas, "sim:src/main/java/p/A.java#A.a", "sim:src/main/java/p/A.java#A.b")?.confianca).toBe("exata");
  });
  it("34. Java: `new Outro()` no mesmo pacote sem import (instancia, exata)", async () => {
    const { arestas } = await rodar({
      "src/main/java/p/A.java": "package p;\npublic class A { void a() { new B(); } }\n",
      "src/main/java/p/B.java": "package p;\npublic class B {}\n",
    });
    expect(acha(arestas, "sim:src/main/java/p/A.java#A.a", "sim:src/main/java/p/B.java#B", "instancia")?.confianca).toBe("exata");
  });
  it("35. Go: pkg.Func() com pacote local importado", async () => {
    const man = [{ tipo: "go.mod", eco: "go", pasta: "", go_modulo: "ex.com/m", go_replaces: [], deps: [], arquivo: "go.mod", nome: "ex.com/m", comandos: [], modulos: [], referencias: [], main: null, bin: [], exports_alvos: [], psr4: [], classmap: [], raizes_python: [], lacunas: [] }];
    const fontes = { "cmd/main.go": 'package main\nimport "ex.com/m/internal/loja"\nfunc main() { loja.Criar() }\n', "internal/loja/loja.go": "package loja\nfunc Criar() {}\n" };
    const arquivos = new Map<string, ArquivoParaResolver>();
    for (const [c, t] of Object.entries(fontes)) arquivos.set(c, { caminho: c, linguagem: "go", extracao: await extrairArquivo(t, "go", c) });
    const res = resolvedorGo.resolver({ arquivos, manifestos: man as never });
    const r = resolverChamadas({ arquivos, ligacoes: res.ligacoes });
    expect(acha(r.arestas, "sim:cmd/main.go#main", "sim:internal/loja/loja.go#Criar")?.confianca).toBe("exata");
  });
  it("36. Go: chamada a função do mesmo pacote em outro arquivo", async () => {
    const { arestas } = await rodar({ "p/a.go": "package p\nfunc A() { B() }\n", "p/b.go": "package p\nfunc B() {}\n" });
    expect(acha(arestas, "sim:p/a.go#A", "sim:p/b.go#B")?.confianca).toBe("exata");
  });
});
