import { describe, expect, it } from "vitest";
import { carregarGabarito, compararComGabarito, lerFixture } from "../../../../tests/fixtures/mapa/comparar";
import { extrairArquivo } from "./registro";

// T-17.10: gabarito `esperado.json` das fixtures PHP (100% do gabarito, sem armadilhas).

const gab = carregarGabarito("php");
describe("extrator PHP: fixtures", () => {
  for (const [caminho, esperado] of Object.entries(gab.arquivos)) {
    it(`${caminho}: 100% do gabarito e nenhuma armadilha`, async () => {
      const e = await extrairArquivo(lerFixture("php", caminho), "php", caminho);
      expect(compararComGabarito(e, esperado)).toEqual([]);
    });
  }
});

describe("extrator PHP: casos de borda", () => {
  const ext = (texto: string, caminho = "src/x.php") => extrairArquivo(texto, "php", caminho);

  it("HTML misturado com PHP não derruba o parse e conta 0 erros", async () => {
    const e = await ext('<div><?php function a() { return 1; } ?></div>\n<p><?= $x ?></p>\n<?php function b() {} ?>\n');
    expect(e.erros_parse).toBe(0);
    expect(e.simbolos.map((s) => s.qualificado)).toEqual(["a", "b"]);
  });

  it("PHP quebrado devolve erros_parse > 0 e ainda extrai o que dá", async () => {
    const e = await ext("<?php\nfunction ok() { return 1; }\nclass { \nfunction ( {\n");
    expect(e.erros_parse).toBeGreaterThan(0);
    expect(e.simbolos.some((s) => s.qualificado === "ok")).toBe(true);
  });

  it("namespace com chaves e sem chaves qualificam os símbolos", async () => {
    const a = await ext("<?php\nnamespace A { class X {} }\nnamespace B { class X {} }\n");
    expect(a.simbolos.map((s) => s.qualificado)).toEqual(["A\\X", "B\\X"]);
    const b = await ext("<?php\nnamespace A;\nclass X { function m() {} }\n");
    expect(b.simbolos.map((s) => s.qualificado)).toEqual(["A\\X", "A\\X.m"]);
  });

  it("classes duplicadas ganham ~2", async () => {
    const e = await ext("<?php\nif ($a) { function f() {} } else { function f() {} }\n");
    expect(e.simbolos.map((s) => s.qualificado)).toEqual(["f", "f~2"]);
  });

  it("literais de texto em atributos e no SQL nunca vazam para o resultado", async () => {
    const e = await ext('<?php\n#[Segredo("tok-secreto-123")]\nclass S { function m() { $p = "password = hunter2 SELECT x FROM t"; } }\n');
    expect(JSON.stringify(e)).not.toContain("tok-secreto-123");
    expect(JSON.stringify(e)).not.toContain("hunter2");
  });

  it("use agrupado e de função geram um import por cláusula", async () => {
    const e = await ext("<?php\nuse A\\{B, C as D};\nuse function A\\f;\n");
    expect(e.imports.map((i) => [i.especificador, i.nomes.map((n) => (n.alias === null ? n.nome : `${n.nome}=${n.alias}`))])).toEqual([
      ["A\\B", ["B"]],
      ["A\\C", ["C=D"]],
      ["A\\f", ["function f"]],
    ]);
  });

  it("require com concatenação de variável é dinâmico e não vira import", async () => {
    const e = await ext("<?php\nrequire $base . '/x.php';\n");
    expect(e.imports).toEqual([]);
    expect(e.dinamicos.map((d) => d.tipo)).toEqual(["require_dinamico"]);
  });

  it("arquivo vazio e só comentário não quebram", async () => {
    expect((await ext("")).simbolos).toEqual([]);
    expect((await ext("<?php\n// nada\n")).loc_comentario).toBe(1);
  });

  it("teto de símbolos: acima de 5 000 corta e marca truncado", async () => {
    const e = await ext(`<?php\n${Array.from({ length: 5100 }, (_, i) => `function f${i}() {}`).join("\n")}`);
    expect(e.simbolos).toHaveLength(5000);
    expect(e.truncado).toBe(true);
  });

  it("caracteres não ASCII não deslocam linhas", async () => {
    const e = await ext('<?php\n$á = "ção";\n/** Docção */\nfunction nãoAscii($á) {}\n');
    const s = e.simbolos.find((x) => x.nome === "nãoAscii");
    expect(s?.linha).toBe(4);
    expect(s?.doc).toBe("Docção");
  });

  it("complexidade: && e || e ?: somam", async () => {
    const e = await ext("<?php\nfunction f($a, $b) { if ($a && $b || $a) { return $a ? 1 : 2; } foreach ($a as $x) {} }\n");
    expect(e.simbolos[0]?.complexidade).toBe(1 + 1 + 2 + 1 + 1);
  });
});
