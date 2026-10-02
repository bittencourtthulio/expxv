import { describe, expect, it } from "vitest";
import { carregarGabarito, compararComGabarito, lerFixture } from "../../../../tests/fixtures/mapa/comparar";
import { extrairArquivo } from "./registro";

// T-17.11: gabarito `esperado.json` das fixtures C# (100% do gabarito, sem armadilhas).

const gab = carregarGabarito("csharp");
describe("extrator C#: fixtures", () => {
  for (const [caminho, esperado] of Object.entries(gab.arquivos)) {
    it(`${caminho}: 100% do gabarito e nenhuma armadilha`, async () => {
      const e = await extrairArquivo(lerFixture("csharp", caminho), "csharp", caminho);
      expect(compararComGabarito(e, esperado)).toEqual([]);
    });
  }
});

describe("extrator C#: casos de borda", () => {
  const ext = (texto: string, caminho = "src/X.cs") => extrairArquivo(texto, "csharp", caminho);

  it("namespace com chaves aninhado e file-scoped qualificam os símbolos", async () => {
    const a = await ext("namespace A { namespace B { class X { void M() {} } } }\n");
    expect(a.simbolos.map((s) => s.qualificado)).toEqual(["A.B.X", "A.B.X.M"]);
    const b = await ext("namespace A.B;\nclass X {}\n");
    expect(b.simbolos.map((s) => s.qualificado)).toEqual(["A.B.X"]);
  });

  it("sobrecargas ganham ~2", async () => {
    const e = await ext("class X { void M() {} void M(int a) {} }\n");
    expect(e.simbolos.map((s) => s.qualificado)).toEqual(["X", "X.M", "X.M~2"]);
  });

  it("using alias, static e global", async () => {
    const e = await ext("global using G.H;\nusing static A.B;\nusing C = D.E;\n");
    expect(e.imports.map((i) => [i.especificador, i.nomes.map((n) => (n.alias === null ? n.nome : `${n.nome}=${n.alias}`))])).toEqual([
      ["G.H", []],
      ["A.B", ["static"]],
      ["D.E", ["*=C"]],
    ]);
  });

  it("controller sem template: Http* puro usa o prefixo; [Route] no método isolado", async () => {
    const e = await ext('[Route("v1/[controller]")]\nclass ItensController { [HttpGet] public void L() {} [HttpPut("{id}/x")] public void U() {} }\n');
    expect(e.entradas.map((x) => x.chave)).toEqual(["GET /v1/itens", "PUT /v1/itens/:id/x"]);
  });

  it("arquivo com erro de sintaxe devolve erros_parse > 0 e ainda extrai o que dá", async () => {
    const e = await ext("class Ok { void A() {} }\nclass { void ( {\n");
    expect(e.erros_parse).toBeGreaterThan(0);
    expect(e.simbolos.some((s) => s.qualificado === "Ok")).toBe(true);
  });

  it("segredos em literais e atributos não vazam; env guarda só o nome", async () => {
    const e = await ext('[Segredo("tok-secreto-9")]\nclass S { void M() { var p = "password = hunter2 SELECT x FROM t"; var v = System.Environment.GetEnvironmentVariable("NOME_X") ?? "padrao-secreto"; } }\n');
    const s = JSON.stringify(e);
    expect(s).not.toContain("tok-secreto-9");
    expect(s).not.toContain("hunter2");
    expect(s).not.toContain("padrao-secreto");
    expect(e.padroes).toEqual([{ tipo: "env", nome: "NOME_X", linha: 2 }]);
  });

  it("arquivo vazio e só comentário não quebram", async () => {
    expect((await ext("")).simbolos).toEqual([]);
    expect((await ext("// nada\n")).loc_comentario).toBe(1);
  });

  it("teto de símbolos: acima de 5 000 corta e marca truncado", async () => {
    const e = await ext(`class C {\n${Array.from({ length: 5100 }, (_, i) => `void M${i}() {}`).join("\n")}\n}`);
    expect(e.simbolos).toHaveLength(5000);
    expect(e.truncado).toBe(true);
  });

  it("caracteres não ASCII não deslocam linhas", async () => {
    const e = await ext('class C {\n  string á = "ção";\n  /// Docção\n  void NãoAscii() {}\n}\n');
    const s = e.simbolos.find((x) => x.nome === "NãoAscii");
    expect(s?.linha).toBe(4);
    expect(s?.doc).toBe("Docção");
  });

  it("complexidade: && || ?? ?: e switch somam", async () => {
    const e = await ext("class C { int M(int a, int b) { if (a > 0 && b > 0 || a < -1) { return a ?? b; } return a > 1 ? 1 : 2; } }\n");
    expect(e.simbolos.find((s) => s.nome === "M")?.complexidade).toBe(1 + 1 + 2 + 1 + 1);
  });
});
