import { describe, expect, it } from "vitest";
import { carregarGabarito, compararComGabarito, lerFixture } from "../../../../tests/fixtures/mapa/comparar";
import { extrairArquivo } from "./registro";

// T-17.09: gabarito `esperado.json` das fixtures Java (100% do gabarito, sem armadilhas).

const gab = carregarGabarito("java");
describe("extrator Java: fixtures", () => {
  for (const [caminho, esperado] of Object.entries(gab.arquivos)) {
    it(`${caminho}: 100% do gabarito e nenhuma armadilha`, async () => {
      const e = await extrairArquivo(lerFixture("java", caminho), "java", caminho);
      expect(compararComGabarito(e, esperado)).toEqual([]);
    });
  }
  it("arquivo com erro de sintaxe: erros_parse > 0 sem lançar", async () => {
    const e = await extrairArquivo(lerFixture("java", "src/main/java/br/app/infra/Quebrado.java"), "java", "src/main/java/br/app/infra/Quebrado.java");
    expect(e.erros_parse).toBeGreaterThan(0);
  });
});

describe("extrator Java: casos de borda", () => {
  const ext = (t: string, c = "src/main/java/X.java") => extrairArquivo(t, "java", c);

  it("arquivo vazio e só comentário", async () => {
    expect((await ext("")).loc).toBe(0);
    const c = await ext("// nada\n");
    expect(c.loc_comentario).toBe(1);
    expect(c.simbolos).toEqual([]);
  });

  it("import estático de método e de curinga", async () => {
    const e = await ext("import static a.b.C.m;\nimport static a.b.D.*;\nclass X {}\n");
    expect(e.imports.map((i) => [i.especificador, i.nomes.map((n) => n.nome)])).toEqual([
      ["a.b.C", ["m"]],
      ["a.b.D", ["*"]],
    ]);
  });

  it("construtor vira <init>; sobrecarga ganha ~2", async () => {
    const e = await ext("class A { A() {} A(int x) {} void f() {} void f(int a) {} }");
    expect(e.simbolos.map((s) => s.qualificado)).toEqual(["A", "A.<init>", "A.<init>~2", "A.f", "A.f~2"]);
  });

  it("classe aninhada e constante static final", async () => {
    const e = await ext("public class A { public static final int MAX = 3; static class B { void m() {} } }");
    expect(e.simbolos.map((s) => `${s.tipo}:${s.qualificado}`)).toEqual(["classe:A", "constante:A.MAX", "classe:A.B", "metodo:A.B.m"]);
  });

  it("literais de texto saem das assinaturas e dos decoradores", async () => {
    const e = await ext('class A { @Path("/segredo-xyz") public void f(@Named("tok-123") String a) {} }');
    expect(JSON.stringify(e.simbolos)).not.toContain("segredo-xyz");
    expect(JSON.stringify(e.simbolos)).not.toContain("tok-123");
  });

  it("System.getenv só registra o NOME", async () => {
    const e = await ext('class A { void f() { String x = System.getenv("TOKEN_A"); String y = System.getenv(nome); } }');
    expect(e.padroes).toEqual([{ tipo: "env", nome: "TOKEN_A", linha: 1 }]);
  });

  it("SQL concatenado com variável vira heurística; prosa nunca vira tabela", async () => {
    const e = await ext('class A { void f() { q("SELECT a FROM clientes WHERE id = " + id); q("Select an item from the cart"); } }');
    expect(e.dados).toEqual([{ tabela: "clientes", operacao: "le", de: "A.f", linha: 1, confianca: "heuristica", fonte: "sql" }]);
  });

  it("text block com SQL", async () => {
    const e = await ext('class A { String s = """\n  DELETE FROM antigos WHERE x = 1\n  """; }');
    expect(e.dados.map((d) => d.tabela)).toEqual(["antigos"]);
  });

  it("@RequestMapping sem método vira ALL; vários caminhos geram várias rotas", async () => {
    const e = await ext('@Controller @RequestMapping("/a") class A { @RequestMapping({"/x", "/y"}) void f() {} }');
    expect(e.entradas.map((x) => x.chave)).toEqual(["ALL /a/x", "ALL /a/y"]);
  });

  it("mapeamento fora de controller é heurística", async () => {
    const e = await ext('interface Api { @GetMapping("/z") void f(); }');
    expect(e.entradas).toEqual([{ tipo: "rota", chave: "GET /z", framework: "spring", handler: "Api.f", linha: 1, confianca: "heuristica" }]);
  });

  it("teto de símbolos: acima de 5 000 corta e marca truncado", async () => {
    const e = await ext(`class A {\n${Array.from({ length: 5100 }, (_, i) => `void f${i}() {}`).join("\n")}\n}`);
    expect(e.simbolos).toHaveLength(5000);
    expect(e.truncado).toBe(true);
  });

  it("caracteres não ASCII não deslocam linhas", async () => {
    const e = await ext("// ção\n/** Docção. */\nclass Ação { void nãoAscii() {} }");
    const s = e.simbolos.find((x) => x.nome === "Ação");
    expect(s?.linha).toBe(3);
    expect(s?.doc).toBe("Docção.");
  });

  it("enum com corpo por constante e interface funcional com default", async () => {
    const e = await ext("enum E { A { void m() {} }; }\ninterface I { default void d() { if (x) {} } }");
    expect(e.simbolos.map((s) => s.qualificado)).toEqual(["E", "E.A.m", "I", "I.d"]);
    expect(e.simbolos[3]?.complexidade).toBe(2);
  });
});

describe("extrator Java: referência cruzada com o `javac`", () => {
  it("as classes (inclusive aninhadas) coincidem com os `.class` gerados", async () => {
    const { spawnSync } = await import("node:child_process");
    const { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    if (spawnSync("javac", ["-version"]).status !== 0) return; // sem JDK: pula
    const fonte = [
      "package ex.dom;",
      "public class Raiz {",
      "  public enum Estado { A, B }",
      "  public interface Visitante { void v(Raiz r); }",
      "  static class Interna { class Mais {} }",
      "  public void m() {}",
      "}",
      "interface Outra {}",
      "enum Cor { X }",
      "record Ponto(int x) {}",
      "",
    ].join("\n");
    const dir = mkdtempSync(join(tmpdir(), "mapa-java-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "Raiz.java"), fonte);
      const r = spawnSync("javac", ["-proc:none", "-d", join(dir, "out"), join(dir, "src", "Raiz.java")], { encoding: "utf8" });
      expect(r.status).toBe(0);
      const classes = readdirSync(join(dir, "out", "ex", "dom"))
        .map((f) => f.replace(".class", "").replace(/\$/g, "."))
        .sort();
      const e = await extrairArquivo(fonte, "java", "src/main/java/ex/dom/Raiz.java");
      const nossos = e.simbolos
        .filter((s) => s.tipo === "classe" || s.tipo === "enum" || s.tipo === "interface")
        .map((s) => s.qualificado)
        .sort();
      expect(nossos).toEqual(classes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
