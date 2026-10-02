import { describe, expect, it } from "vitest";
import { citar, dividirLinha, escreverAmbiente, juntarLinha, lerAmbiente, slugDe } from "./linha";

describe("dividirLinha (edição de argumentos; nunca shell)", () => {
  it.each([
    ["npm run dev", ["npm", "run", "dev"]],
    ["  a   b  ", ["a", "b"]],
    ["cmd 'com espaço' \"outro valor\"", ["cmd", "com espaço", "outro valor"]],
    ["x --flag=\"a b\"", ["x", "--flag=a b"]],
    ["a\\ b c", ["a b", "c"]],
    ["''", [""]],
    ["", []],
    ["a '$(x)' `y` ;", ["a", "$(x)", "`y`", ";"]],
    ['"a\\"b"', ['a"b']],
  ])("%j", (linha, esperado) => expect(dividirLinha(linha)).toEqual({ ok: true, argumentos: esperado }));
  it("aspas abertas é erro", () => {
    expect(dividirLinha("a 'b").ok).toBe(false);
    expect(dividirLinha('a "b').ok).toBe(false);
  });
  it("ida e volta preserva os argumentos", () => {
    for (const args of [["a", "b c", "it's", "$(x)", "", "--k=v w"], ["npm", "run", "dev"]]) {
      expect(dividirLinha(juntarLinha(args))).toEqual({ ok: true, argumentos: args });
    }
    expect(citar("simples-1.2")).toBe("simples-1.2");
  });
});

describe("ambiente e slug", () => {
  it("lê NOME=valor, ignora vazias e comentários, cita a linha com erro", () => {
    expect(lerAmbiente("A=1\n\n# c\nB=x y=z")).toEqual({ ok: true, ambiente: { A: "1", B: "x y=z" } });
    expect(lerAmbiente("A=1\nruim")).toEqual({ ok: false, erro: "Ambiente, linha 2: use NOME=valor" });
    expect(escreverAmbiente({ A: "1", B: "2" })).toBe("A=1\nB=2");
  });
  it("slug sem acento e dentro do padrão do id", () => {
    expect(slugDe("Build e Rodar!")).toBe("build-e-rodar");
    expect(slugDe("Ação rápida")).toBe("acao-rapida");
    expect(slugDe("???")).toBe("exec");
    expect(slugDe("x".repeat(80)).length).toBe(36);
  });
});
